import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { one, pool, S, tx } from '../lib/db.js';
import { decrypt, encrypt, legacyDecrypt } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { moneyLimiter } from '../middleware/security.js';
import { idParam } from './commerce.js';

/**
 * Messages are encrypted at rest: every message is AES-256-GCM encrypted
 * with the conversation id as associated data (a ciphertext can't be moved to
 * another conversation). Old messages (AES-CBC / plain text) still display.
 */
export const messagesRouter = Router();
messagesRouter.use(requireAuth);

export function readMessage(content: string, conversationId: string): string {
  if (!content) return '';
  if (content.startsWith('gcm1:')) {
    try {
      return decrypt(content, `msg:${conversationId}`);
    } catch {
      return '[unreadable message]';
    }
  }
  if (content.startsWith('ENC|') || content.startsWith('enc:')) {
    return legacyDecrypt(content, env.LEGACY_MESSAGE_ENCRYPTION_KEY) ?? '[unreadable message]';
  }
  return content;
}

const content = z.string().trim().min(1, 'Message is empty').max(2000, 'Message is too long');

async function participant(conversationId: string, userId: string) {
  const p = await one(`SELECT 1 FROM ${S}.conversation_participants WHERE conversation_id = $1 AND user_id = $2`, [conversationId, userId]);
  if (!p) throw notFound('Conversation not found');
}

messagesRouter.get(
  '/search-users',
  validate({ query: z.object({ q: z.string().trim().min(2).max(64) }).strict() }),
  ah(async (req, res) => {
    const q = `%${String(req.query.q).replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    const r = await pool.query(
      `SELECT id, full_name, role, profile_image FROM ${S}.users
        WHERE full_name ILIKE $1 AND id <> $2 AND role <> 'admin' AND status = 'active' ORDER BY full_name LIMIT 20`,
      [q, req.auth!.userId],
    );
    res.json({ success: true, data: { users: r.rows } });
  }),
);

messagesRouter.get(
  '/conversations',
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const r = await pool.query(
      `SELECT c.id, c.type, c.title, c.status, c.created_at, c.updated_at, c.created_by,
              lm.content AS last_content, lm.created_at AS last_at, lm.sender_id AS last_sender,
              (SELECT count(*)::int FROM ${S}.messages m WHERE m.conversation_id = c.id AND m.sender_id IS DISTINCT FROM $1
                 AND NOT COALESCE(m.is_deleted,false) AND m.created_at > COALESCE(cp.last_read_at, 'epoch')) AS unread,
              COALESCE((SELECT json_agg(json_build_object('id', u.id, 'full_name', u.full_name, 'role', u.role, 'profile_image', u.profile_image))
                          FROM ${S}.conversation_participants op JOIN ${S}.users u ON u.id = op.user_id
                         WHERE op.conversation_id = c.id AND op.user_id <> $1), '[]') AS participants
         FROM ${S}.conversation_participants cp
         JOIN ${S}.conversations c ON c.id = cp.conversation_id
         LEFT JOIN LATERAL (SELECT content, created_at, sender_id FROM ${S}.messages
                             WHERE conversation_id = c.id AND NOT COALESCE(is_deleted,false) ORDER BY created_at DESC LIMIT 1) lm ON true
        WHERE cp.user_id = $1
        ORDER BY COALESCE(lm.created_at, c.created_at) DESC LIMIT 100`,
      [me],
    );
    res.json({
      success: true,
      data: {
        conversations: r.rows.map((c) => ({
          ...c,
          last_content: undefined,
          lastMessage: c.last_at ? { content: readMessage(c.last_content, String(c.id)), created_at: c.last_at, sender_id: c.last_sender } : null,
        })),
      },
    });
  }),
);

messagesRouter.post(
  '/conversations',
  validate({
    body: z
      .object({ type: z.enum(['direct', 'support']), recipientId: idParam.optional(), title: z.string().trim().max(80).optional() })
      .strict(),
  }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const { type, recipientId, title } = req.body;
    if (type === 'support') {
      const existing = await one<any>(
        `SELECT c.id FROM ${S}.conversations c JOIN ${S}.conversation_participants p ON p.conversation_id = c.id
          WHERE p.user_id = $1 AND c.type = 'support' AND c.status = 'active' AND c.created_by = $1 LIMIT 1`,
        [me],
      );
      if (existing) return res.json({ success: true, data: { conversationId: existing.id, existing: true } });
      const id = await tx(async (c) => {
        const conv = await one<any>(
          `INSERT INTO ${S}.conversations (type, title, created_by, status) VALUES ('support', $2, $1, 'active') RETURNING id`,
          [me, title || 'Support request'],
          c,
        );
        await c.query(
          `INSERT INTO ${S}.conversation_participants (conversation_id, user_id)
           SELECT $1, id FROM ${S}.users WHERE role = 'admin' AND status = 'active' AND id <> $2
           UNION SELECT $1, $2`,
          [conv.id, me],
        );
        return conv.id;
      });
      return res.status(201).json({ success: true, data: { conversationId: id, existing: false } });
    }
    if (!recipientId) throw badRequest('RECIPIENT_REQUIRED', 'Choose who to message');
    if (String(recipientId) === String(me)) throw badRequest('SELF', 'You cannot message yourself');
    const target = await one<any>(`SELECT id, role, status FROM ${S}.users WHERE id = $1`, [recipientId]);
    if (!target || target.status !== 'active' || target.role === 'admin') throw notFound('User not found');
    const existing = await one<any>(
      `SELECT c.id FROM ${S}.conversations c
         JOIN ${S}.conversation_participants a ON a.conversation_id = c.id AND a.user_id = $1
         JOIN ${S}.conversation_participants b ON b.conversation_id = c.id AND b.user_id = $2
        WHERE c.type = 'direct' LIMIT 1`,
      [me, recipientId],
    );
    if (existing) return res.json({ success: true, data: { conversationId: existing.id, existing: true } });
    const id = await tx(async (c) => {
      const conv = await one<any>(`INSERT INTO ${S}.conversations (type, title, created_by, status) VALUES ('direct', $2, $1, 'active') RETURNING id`, [me, title ?? null], c);
      await c.query(`INSERT INTO ${S}.conversation_participants (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`, [conv.id, me, recipientId]);
      return conv.id;
    });
    res.status(201).json({ success: true, data: { conversationId: id, existing: false } });
  }),
);

messagesRouter.patch(
  '/conversations/:id/close',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const conv = await one<any>(`SELECT created_by FROM ${S}.conversations WHERE id = $1`, [req.params.id]);
    if (!conv) throw notFound('Conversation not found');
    await participant(req.params.id!, req.auth!.userId);
    if (String(conv.created_by) !== String(req.auth!.userId) && req.auth!.role !== 'admin') throw forbidden();
    await pool.query(`UPDATE ${S}.conversations SET status = 'closed', updated_at = now() WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  }),
);

messagesRouter.get(
  '/conversations/:id/messages',
  validate({
    params: z.object({ id: idParam }).strict(),
    query: z.object({ before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict(),
  }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    await participant(req.params.id!, me);
    const q = req.query as any;
    const r = await pool.query(
      `SELECT m.id, m.content, m.created_at, m.is_edited, m.sender_id, u.full_name AS sender_name, u.profile_image AS sender_image, u.role AS sender_role
         FROM ${S}.messages m LEFT JOIN ${S}.users u ON u.id = m.sender_id
        WHERE m.conversation_id = $1 AND NOT COALESCE(m.is_deleted,false) AND ($2::timestamptz IS NULL OR m.created_at < $2)
        ORDER BY m.created_at DESC LIMIT $3`,
      [req.params.id, q.before ?? null, q.limit],
    );
    await pool.query(`UPDATE ${S}.conversation_participants SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2`, [req.params.id, me]);
    res.json({
      success: true,
      data: { messages: r.rows.reverse().map((m) => ({ ...m, content: readMessage(m.content, String(req.params.id)), mine: String(m.sender_id) === String(me) })) },
    });
  }),
);

messagesRouter.post(
  '/conversations/:id/messages',
  moneyLimiter,
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ content }).strict() }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    await participant(req.params.id!, me);
    const conv = await one<any>(`SELECT status FROM ${S}.conversations WHERE id = $1`, [req.params.id]);
    if (conv?.status === 'closed') throw forbidden('This conversation is closed', 'CONVERSATION_CLOSED');
    const m = await one<any>(
      `INSERT INTO ${S}.messages (conversation_id, sender_id, content, is_edited, is_deleted) VALUES ($1, $2, $3, false, false) RETURNING id, created_at`,
      [req.params.id, me, encrypt(req.body.content, `msg:${req.params.id}`)],
    );
    await pool.query(`UPDATE ${S}.conversations SET updated_at = now() WHERE id = $1`, [req.params.id]);
    await pool.query(`UPDATE ${S}.conversation_participants SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2`, [req.params.id, me]);
    res.status(201).json({ success: true, data: { message: { id: m.id, content: req.body.content, created_at: m.created_at, sender_id: me, mine: true } } });
  }),
);

messagesRouter.patch(
  '/messages/:id',
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ content }).strict() }),
  ah(async (req, res) => {
    const m = await one<any>(`SELECT sender_id, conversation_id, created_at, is_deleted FROM ${S}.messages WHERE id = $1`, [req.params.id]);
    if (!m || m.is_deleted || String(m.sender_id) !== String(req.auth!.userId)) throw notFound('Message not found');
    if (Date.now() - new Date(m.created_at).getTime() > 15 * 60_000) throw forbidden('Messages can only be edited for 15 minutes', 'EDIT_WINDOW');
    await pool.query(`UPDATE ${S}.messages SET content = $2, is_edited = true, edited_at = now() WHERE id = $1`, [
      req.params.id,
      encrypt(req.body.content, `msg:${m.conversation_id}`),
    ]);
    res.json({ success: true });
  }),
);

messagesRouter.delete(
  '/messages/:id',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const r = await pool.query(`UPDATE ${S}.messages SET is_deleted = true, content = '' WHERE id = $1 AND sender_id = $2`, [req.params.id, req.auth!.userId]);
    if (r.rowCount === 0) throw notFound('Message not found');
    res.json({ success: true });
  }),
);

messagesRouter.get(
  '/unread-count',
  ah(async (req, res) => {
    const r = await one<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${S}.conversation_participants cp JOIN ${S}.messages m ON m.conversation_id = cp.conversation_id
        WHERE cp.user_id = $1 AND m.sender_id IS DISTINCT FROM $1 AND NOT COALESCE(m.is_deleted,false) AND m.created_at > COALESCE(cp.last_read_at, 'epoch')`,
      [req.auth!.userId],
    );
    res.json({ success: true, data: { unread: Number(r?.n ?? 0) } });
  }),
);

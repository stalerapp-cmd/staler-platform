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
import { notifyBi } from './walletCore.js';

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

const LINK_RE = /https?:\/\/[^\s]+/;

/** Stores an (encrypted) message and tells the other participants — one notification per chat until they read it. */
export async function postMessage(conversationId: string, me: string, text: string, o: { replyTo?: string; kind?: 'text' | 'link'; meta?: Record<string, unknown> } = {}) {
  await participant(conversationId, me);
  const conv = await one<any>(`SELECT status, type FROM ${S}.conversations WHERE id = $1`, [conversationId]);
  if (conv?.status === 'closed') throw forbidden('This conversation is closed', 'CONVERSATION_CLOSED');
  if (o.replyTo && !(await one(`SELECT 1 FROM ${S}.messages WHERE id = $1 AND conversation_id = $2`, [o.replyTo, conversationId]))) throw notFound('Message not found');
  const kind = o.kind ?? (LINK_RE.test(text) ? 'link' : 'text');
  const m = await one<any>(
    `INSERT INTO ${S}.messages (conversation_id, sender_id, content, is_edited, is_deleted, reply_to, kind, meta) VALUES ($1, $2, $3, false, false, $4, $5, $6)
     RETURNING id, created_at, reply_to, kind, meta, reactions`,
    [conversationId, me, encrypt(text, `msg:${conversationId}`), o.replyTo ?? null, kind, o.meta ? JSON.stringify(o.meta) : null],
  );
  await pool.query(`UPDATE ${S}.conversations SET updated_at = now(), last_message_at = now() WHERE id = $1`, [conversationId]);
  await pool.query(`UPDATE ${S}.conversation_participants SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2`, [conversationId, me]);
  const sender = await one<{ full_name: string }>(`SELECT full_name FROM ${S}.users WHERE id = $1`, [me]);
  const others = await pool.query(
    `SELECT p.user_id FROM ${S}.conversation_participants p WHERE p.conversation_id = $1 AND p.user_id <> $2
        AND NOT EXISTS (SELECT 1 FROM ${S}.notifications n WHERE n.user_id = p.user_id AND n.type = 'message' AND NOT n.is_read
                         AND n.metadata->>'conversationId' = $1::text)`,
    [conversationId, me],
  );
  const preview = kind === 'link' ? '🔗' : text.slice(0, 80);
  for (const r of others.rows) {
    await notifyBi(undefined, r.user_id, 'message', [`New message from ${sender?.full_name ?? 'someone'}`, preview], [`رسالة جديدة من ${sender?.full_name ?? 'حدا'}`, preview], {
      conversationId,
    });
  }
  return { id: m.id, content: text, created_at: m.created_at, sender_id: me, mine: true, reply_to: m.reply_to, kind: m.kind, meta: m.meta, reactions: m.reactions };
}

const EMOJI = z.string().min(1).max(16).regex(/^\p{Extended_Pictographic}[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0f]*$/u, 'Pick an emoji');

messagesRouter.post(
  '/messages/:id/react',
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ emoji: EMOJI }).strict() }),
  ah(async (req, res) => {
    const me = String(req.auth!.userId);
    const m = await one<any>(`SELECT conversation_id, reactions, is_deleted FROM ${S}.messages WHERE id = $1`, [req.params.id]);
    if (!m || m.is_deleted) throw notFound('Message not found');
    await participant(String(m.conversation_id), me);
    const r: Record<string, string[]> = { ...(m.reactions ?? {}) };
    // One reaction per person: toggling the same emoji removes it, a new one replaces the old.
    const had = (r[req.body.emoji] ?? []).includes(me);
    for (const k of Object.keys(r)) {
      r[k] = r[k]!.filter((u) => u !== me);
      if (!r[k]!.length) delete r[k];
    }
    if (!had) r[req.body.emoji] = [...(r[req.body.emoji] ?? []), me];
    await pool.query(`UPDATE ${S}.messages SET reactions = $2 WHERE id = $1`, [req.params.id, JSON.stringify(r)]);
    res.json({ success: true, data: { reactions: r } });
  }),
);

/** Share a store / product link straight into a chat with someone. */
messagesRouter.post(
  '/share',
  moneyLimiter,
  validate({
    body: z
      .object({
        recipientId: idParam,
        url: z.string().url().max(500),
        title: z.string().trim().min(1).max(120),
        note: z.string().trim().max(300).optional(),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const u = new URL(req.body.url);
    if (u.origin !== new URL(env.PUBLIC_URL).origin) throw badRequest('FOREIGN_LINK', 'Only S-Taler links can be shared here');
    if (String(req.body.recipientId) === String(me)) throw badRequest('SELF', 'You cannot message yourself');
    const target = await one<any>(`SELECT id, role, status FROM ${S}.users WHERE id = $1`, [req.body.recipientId]);
    if (!target || target.status !== 'active' || target.role === 'admin') throw notFound('User not found');
    const existing = await one<any>(
      `SELECT c.id FROM ${S}.conversations c
         JOIN ${S}.conversation_participants a ON a.conversation_id = c.id AND a.user_id = $1
         JOIN ${S}.conversation_participants b ON b.conversation_id = c.id AND b.user_id = $2
        WHERE c.type IN ('user_to_user', 'merchant', 'exchange') AND c.status = 'active' LIMIT 1`,
      [me, req.body.recipientId],
    );
    const id =
      existing?.id ??
      (await tx(async (c) => {
        const conv = await one<any>(`INSERT INTO ${S}.conversations (type, created_by, status) VALUES ('user_to_user', $1, 'active') RETURNING id`, [me], c);
        await c.query(`INSERT INTO ${S}.conversation_participants (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`, [conv.id, me, req.body.recipientId]);
        return conv.id;
      }));
    const text = `${req.body.note ? `${req.body.note}\n` : ''}${req.body.title}\n${u.toString()}`;
    await postMessage(String(id), me, text, { kind: 'link', meta: { url: u.toString(), title: req.body.title } });
    res.status(201).json({ success: true, data: { conversationId: id } });
  }),
);

messagesRouter.get(
  '/search-users',
  validate({ query: z.object({ q: z.string().trim().min(2).max(64) }).strict() }),
  ah(async (req, res) => {
    const q = `%${String(req.query.q).replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    const r = await pool.query(
      `SELECT u.id, u.full_name, u.role, u.profile_image, w.wallet_id FROM ${S}.users u LEFT JOIN ${S}.wallets w ON w.user_id = u.id
        WHERE (u.full_name ILIKE $1 OR lower(u.email) = lower($3) OR w.wallet_id = $3) AND u.id <> $2 AND u.role <> 'admin' AND u.status = 'active'
        ORDER BY (lower(u.email) = lower($3) OR w.wallet_id = $3) DESC, u.full_name LIMIT 20`,
      [q, req.auth!.userId, String(req.query.q).trim()],
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
      // 'direct' is accepted from older app versions; it is stored as the database's 'user_to_user'.
      .object({ type: z.enum(['direct', 'user_to_user', 'support']), recipientId: idParam.optional(), title: z.string().trim().max(80).optional() })
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
           SELECT $1::uuid, id FROM ${S}.users WHERE role = 'admin' AND status = 'active' AND id <> $2::uuid
           UNION SELECT $1::uuid, $2::uuid`,
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
        WHERE c.type IN ('user_to_user', 'merchant', 'exchange') LIMIT 1`,
      [me, recipientId],
    );
    if (existing) return res.json({ success: true, data: { conversationId: existing.id, existing: true } });
    const id = await tx(async (c) => {
      const conv = await one<any>(`INSERT INTO ${S}.conversations (type, title, created_by, status) VALUES ('user_to_user', $2, $1, 'active') RETURNING id`, [me, title ?? null], c);
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
      `SELECT m.id, m.content, m.created_at, m.is_edited, COALESCE(m.is_deleted,false) AS is_deleted, m.sender_id, m.reactions, m.kind, m.meta, m.reply_to,
              u.full_name AS sender_name, u.profile_image AS sender_image, u.role AS sender_role,
              r.content AS reply_content, ru.full_name AS reply_name, COALESCE(r.is_deleted,false) AS reply_deleted
         FROM ${S}.messages m LEFT JOIN ${S}.users u ON u.id = m.sender_id
         LEFT JOIN ${S}.messages r ON r.id = m.reply_to AND r.conversation_id = m.conversation_id
         LEFT JOIN ${S}.users ru ON ru.id = r.sender_id
        WHERE m.conversation_id = $1 AND ($2::timestamptz IS NULL OR m.created_at < $2)
        ORDER BY m.created_at DESC LIMIT $3`,
      [req.params.id, q.before ?? null, q.limit],
    );
    await pool.query(`UPDATE ${S}.conversation_participants SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2`, [req.params.id, me]);
    res.json({
      success: true,
      data: {
        messages: r.rows.reverse().map(({ reply_content, reply_name, reply_deleted, ...m }) => ({
          ...m,
          content: m.is_deleted ? '' : readMessage(m.content, String(req.params.id)),
          meta: m.is_deleted ? null : m.meta,
          mine: String(m.sender_id) === String(me),
          reply: m.reply_to ? { name: reply_name, content: reply_deleted ? '' : readMessage(reply_content ?? '', String(req.params.id)).slice(0, 140), deleted: reply_deleted } : null,
        })),
      },
    });
  }),
);

messagesRouter.post(
  '/conversations/:id/messages',
  moneyLimiter,
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ content, replyTo: idParam.optional() }).strict() }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const message = await postMessage(String(req.params.id), me, req.body.content, { replyTo: req.body.replyTo });
    res.status(201).json({ success: true, data: { message } });
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
    const r = await pool.query(`UPDATE ${S}.messages SET is_deleted = true, content = '[deleted]', meta = NULL, reactions = '{}'::jsonb WHERE id = $1 AND sender_id = $2 AND NOT COALESCE(is_deleted,false)`, [req.params.id, req.auth!.userId]);
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

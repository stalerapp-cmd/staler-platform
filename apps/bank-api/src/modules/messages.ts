import { Router } from 'express';
import { z } from 'zod';
import { one, pool, S, tx } from '../lib/db.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { uuid, validate } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { moneyLimiter } from '../middleware/security.js';
import { notify } from './ledger.js';
import { resolveRecipient } from './banking.js';
import { assertNotBlocked, blockedSql } from './scheduled.js';

/**
 * Messages between customers, as in the S-Taler wallet. Each message is
 * AES-256-GCM encrypted with its conversation id as associated data, so a
 * ciphertext can't be moved to another chat. Blocks stop new messages and hide
 * people from search. Staff talk to customers through support, not here.
 */
export const messagesRouter = Router();
messagesRouter.use(requireAuth);

const aad = (conversationId: string) => `msg:${conversationId}`;
function read(content: string, conversationId: string) {
  if (!content) return '';
  try {
    return decrypt(content, aad(conversationId));
  } catch {
    return '[unreadable message]';
  }
}
const content = z.string().trim().min(1, 'Message is empty').max(2000, 'Message is too long');
const EMOJI = z.string().min(1).max(16).regex(/^\p{Extended_Pictographic}[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️]*$/u, 'Pick an emoji');

/** Only customers message each other. */
async function customer(id: string) {
  const u = await one<any>(`SELECT id, full_name, username, role, status, customer_type, business_name, profile_image FROM ${S}.users WHERE id = $1`, [id]);
  if (!u || u.role !== 'user' || u.status !== 'active') return null;
  return u;
}
async function requireCustomer(id: string) {
  const u = await customer(id);
  if (!u) throw forbidden('Messages are between customers — staff answer in support', 'NOT_A_CUSTOMER');
  return u;
}
async function participant(conversationId: string, userId: string) {
  const p = await one(`SELECT 1 FROM ${S}.conversation_participants WHERE conversation_id = $1 AND user_id = $2`, [conversationId, userId]);
  if (!p) throw notFound('Conversation not found');
}
const otherOf = (conversationId: string, me: string) =>
  one<any>(`SELECT user_id FROM ${S}.conversation_participants WHERE conversation_id = $1 AND user_id <> $2 LIMIT 1`, [conversationId, me]);
const person = (u: any) => ({
  id: u.id,
  full_name: u.full_name,
  username: u.username,
  profile_image: u.profile_image ?? null,
  kind: u.customer_type ?? 'personal',
  business: u.customer_type && u.customer_type !== 'personal' ? u.business_name : null,
});

/** Find someone to message by their exact @username, e-mail, IBAN or account number (never by name). */
messagesRouter.get(
  '/search',
  validate({ query: z.object({ q: z.string().trim().min(3).max(254) }).strict() }),
  ah(async (req, res) => {
    const me = String(req.auth!.userId);
    const q = String(req.query.q).trim();
    let id: string | null = null;
    if (q.includes('@') && !q.startsWith('@')) {
      const r = await one<any>(`SELECT id FROM ${S}.users WHERE lower(email) = lower($1)`, [q]);
      id = r?.id ?? null;
    } else {
      try {
        id = String((await resolveRecipient(q)).user_id);
      } catch {
        id = null;
      }
    }
    const u = id && id !== me ? await customer(id) : null;
    const blocked = u ? (await one<any>(`SELECT ${blockedSql('$1::uuid', '$2::uuid')} AS x`, [me, u.id]))?.x : false;
    res.json({ success: true, data: { users: u && !blocked ? [person(u)] : [] } });
  }),
);

messagesRouter.get(
  '/conversations',
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const r = await pool.query(
      `SELECT c.id, c.created_at, lm.content AS last_content, lm.created_at AS last_at, lm.sender_id AS last_sender, COALESCE(lm.is_deleted, false) AS last_deleted,
              (SELECT count(*)::int FROM ${S}.messages m WHERE m.conversation_id = c.id AND m.sender_id IS DISTINCT FROM $1 AND NOT m.is_deleted
                  AND m.created_at > COALESCE(cp.last_read_at, 'epoch')) AS unread,
              u.id AS other_id, u.full_name, u.username, u.profile_image, u.customer_type, u.business_name, u.status AS other_status,
              ${blockedSql('$1', 'u.id')} AS blocked,
              (SELECT b.nickname FROM ${S}.beneficiaries b JOIN ${S}.bank_accounts a ON a.id = b.account_id WHERE b.owner_id = $1 AND a.user_id = u.id AND b.nickname IS NOT NULL LIMIT 1) AS nickname
         FROM ${S}.conversation_participants cp
         JOIN ${S}.conversations c ON c.id = cp.conversation_id
         JOIN ${S}.conversation_participants op ON op.conversation_id = c.id AND op.user_id <> $1
         JOIN ${S}.users u ON u.id = op.user_id
         LEFT JOIN LATERAL (SELECT content, created_at, sender_id, is_deleted FROM ${S}.messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) lm ON true
        WHERE cp.user_id = $1
        ORDER BY COALESCE(lm.created_at, c.created_at) DESC LIMIT 200`,
      [me],
    );
    res.json({
      success: true,
      data: {
        conversations: r.rows.map((c) => ({
          id: c.id,
          unread: c.unread,
          blocked: c.blocked,
          other: { ...person({ ...c, id: c.other_id }), nickname: c.nickname, active: c.other_status === 'active' },
          lastMessage: c.last_at ? { content: c.last_deleted ? '' : read(c.last_content, String(c.id)), deleted: c.last_deleted, created_at: c.last_at, mine: String(c.last_sender) === String(me) } : null,
        })),
      },
    });
  }),
);

messagesRouter.get(
  '/unread',
  ah(async (req, res) => {
    const r = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${S}.conversation_participants cp JOIN ${S}.messages m ON m.conversation_id = cp.conversation_id
        WHERE cp.user_id = $1 AND m.sender_id IS DISTINCT FROM $1 AND NOT m.is_deleted AND m.created_at > COALESCE(cp.last_read_at, 'epoch')`,
      [req.auth!.userId],
    );
    res.json({ success: true, data: { unread: r?.n ?? 0 } });
  }),
);

/** Open (or reuse) the chat with one person. */
messagesRouter.post(
  '/conversations',
  validate({ body: z.object({ userId: uuid }).strict() }),
  ah(async (req, res) => {
    const me = String(req.auth!.userId);
    await requireCustomer(me);
    if (String(req.body.userId) === me) throw badRequest('SELF', 'You cannot message yourself');
    const u = await customer(req.body.userId);
    if (!u) throw notFound('User not found');
    await assertNotBlocked(me, String(u.id));
    const existing = await one<any>(
      `SELECT a.conversation_id AS id FROM ${S}.conversation_participants a JOIN ${S}.conversation_participants b ON b.conversation_id = a.conversation_id AND b.user_id = $2
        WHERE a.user_id = $1 LIMIT 1`,
      [me, u.id],
    );
    if (existing) return res.json({ success: true, data: { conversationId: existing.id, existing: true } });
    const id = await tx(async (c) => {
      const conv = await one<any>(`INSERT INTO ${S}.conversations (created_by) VALUES ($1) RETURNING id`, [me], c);
      await c.query(`INSERT INTO ${S}.conversation_participants (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`, [conv.id, me, u.id]);
      return conv.id;
    });
    res.status(201).json({ success: true, data: { conversationId: id, existing: false } });
  }),
);

messagesRouter.get(
  '/conversations/:id/messages',
  validate({ params: z.object({ id: uuid }).strict(), query: z.object({ before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(60) }).strict() }),
  ah(async (req, res) => {
    const me = String(req.auth!.userId);
    const id = String(req.params.id);
    await participant(id, me);
    const q = req.query as any;
    const r = await pool.query(
      `SELECT m.id, m.content, m.created_at, m.is_edited, m.is_deleted, m.sender_id, m.reactions, m.reply_to,
              u.full_name AS sender_name, r.content AS reply_content, ru.full_name AS reply_name, COALESCE(r.is_deleted, false) AS reply_deleted
         FROM ${S}.messages m LEFT JOIN ${S}.users u ON u.id = m.sender_id
         LEFT JOIN ${S}.messages r ON r.id = m.reply_to AND r.conversation_id = m.conversation_id
         LEFT JOIN ${S}.users ru ON ru.id = r.sender_id
        WHERE m.conversation_id = $1 AND ($2::timestamptz IS NULL OR m.created_at < $2)
        ORDER BY m.created_at DESC LIMIT $3`,
      [id, q.before ?? null, q.limit],
    );
    await pool.query(`UPDATE ${S}.conversation_participants SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2`, [id, me]);
    // Reading the chat also clears its message notification.
    await pool.query(`UPDATE ${S}.notifications SET is_read = true WHERE user_id = $1 AND type = 'message' AND NOT is_read AND metadata->>'conversationId' = $2`, [me, id]);
    const other = await otherOf(id, me);
    const peer = other ? await one<any>(`SELECT last_read_at FROM ${S}.conversation_participants WHERE conversation_id = $1 AND user_id = $2`, [id, other.user_id]) : null;
    res.json({
      success: true,
      data: {
        /** When the other person last read the chat (for "seen"). */
        seenAt: peer?.last_read_at ?? null,
        messages: r.rows.reverse().map(({ reply_content, reply_name, reply_deleted, ...m }) => ({
          ...m,
          content: m.is_deleted ? '' : read(m.content, id),
          reactions: m.is_deleted ? {} : m.reactions,
          mine: String(m.sender_id) === me,
          reply: m.reply_to ? { name: reply_name, content: reply_deleted ? '' : read(reply_content ?? '', id).slice(0, 140), deleted: reply_deleted } : null,
        })),
      },
    });
  }),
);

messagesRouter.post(
  '/conversations/:id/messages',
  moneyLimiter,
  validate({ params: z.object({ id: uuid }).strict(), body: z.object({ content, replyTo: uuid.optional() }).strict() }),
  ah(async (req, res) => {
    const me = String(req.auth!.userId);
    const id = String(req.params.id);
    await participant(id, me);
    const other = await otherOf(id, me);
    if (!other || !(await customer(String(other.user_id)))) throw forbidden('This person can’t receive messages now', 'RECIPIENT_UNAVAILABLE');
    await assertNotBlocked(me, String(other.user_id));
    if (req.body.replyTo && !(await one(`SELECT 1 FROM ${S}.messages WHERE id = $1 AND conversation_id = $2`, [req.body.replyTo, id]))) throw notFound('Message not found');
    const m = await one<any>(
      `INSERT INTO ${S}.messages (conversation_id, sender_id, content, reply_to) VALUES ($1, $2, $3, $4) RETURNING id, created_at, reply_to, reactions`,
      [id, me, encrypt(req.body.content, aad(id)), req.body.replyTo ?? null],
    );
    await pool.query(`UPDATE ${S}.conversations SET last_message_at = now() WHERE id = $1`, [id]);
    await pool.query(`UPDATE ${S}.conversation_participants SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2`, [id, me]);
    // One notification per chat until it's read.
    const waiting = await one(`SELECT 1 FROM ${S}.notifications WHERE user_id = $1 AND type = 'message' AND NOT is_read AND metadata->>'conversationId' = $2`, [other.user_id, id]);
    if (!waiting) {
      const s = await one<any>(`SELECT full_name FROM ${S}.users WHERE id = $1`, [me]);
      const preview = req.body.content.slice(0, 80);
      await notify(undefined, String(other.user_id), 'message', `New message from ${s?.full_name ?? 'someone'}`, preview, {
        conversationId: id,
        link: `/app/messages/${id}`,
        ar: { title: `رسالة جديدة من ${s?.full_name ?? 'حدا'}`, body: preview },
      });
    }
    res.status(201).json({ success: true, data: { message: { id: m.id, content: req.body.content, created_at: m.created_at, sender_id: me, mine: true, reply_to: m.reply_to, reactions: m.reactions } } });
  }),
);

messagesRouter.patch(
  '/messages/:id',
  validate({ params: z.object({ id: uuid }).strict(), body: z.object({ content }).strict() }),
  ah(async (req, res) => {
    const m = await one<any>(`SELECT sender_id, conversation_id, created_at, is_deleted FROM ${S}.messages WHERE id = $1`, [req.params.id]);
    if (!m || m.is_deleted || String(m.sender_id) !== String(req.auth!.userId)) throw notFound('Message not found');
    if (Date.now() - new Date(m.created_at).getTime() > 15 * 60_000) throw forbidden('Messages can only be edited for 15 minutes', 'EDIT_WINDOW');
    await pool.query(`UPDATE ${S}.messages SET content = $2, is_edited = true, edited_at = now() WHERE id = $1`, [req.params.id, encrypt(req.body.content, aad(String(m.conversation_id)))]);
    res.json({ success: true });
  }),
);

messagesRouter.delete(
  '/messages/:id',
  validate({ params: z.object({ id: uuid }).strict() }),
  ah(async (req, res) => {
    const r = await pool.query(`UPDATE ${S}.messages SET is_deleted = true, content = '', reactions = '{}'::jsonb WHERE id = $1 AND sender_id = $2 AND NOT is_deleted`, [req.params.id, req.auth!.userId]);
    if (r.rowCount === 0) throw notFound('Message not found');
    res.json({ success: true });
  }),
);

messagesRouter.post(
  '/messages/:id/react',
  validate({ params: z.object({ id: uuid }).strict(), body: z.object({ emoji: EMOJI }).strict() }),
  ah(async (req, res) => {
    const me = String(req.auth!.userId);
    const m = await one<any>(`SELECT conversation_id, reactions, is_deleted FROM ${S}.messages WHERE id = $1`, [req.params.id]);
    if (!m || m.is_deleted) throw notFound('Message not found');
    await participant(String(m.conversation_id), me);
    const r: Record<string, string[]> = { ...(m.reactions ?? {}) };
    // One reaction per person: the same emoji again removes it, a new one replaces the old.
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

import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { one, pool, S, tx } from '../lib/db.js';
import { decrypt, encrypt, legacyDecrypt } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { assertNotBlocked, blockedSql } from './blocks.js';
import { awaySql } from './leaves.js';
import { moneyLimiter } from '../middleware/security.js';
import { idParam } from './commerce.js';
import { notifyBi } from './walletCore.js';
import { PERMISSIONS } from '../lib/permissions.js';

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

// ------------------------------------------------------------------ support
/** What a support request is about, and the permission an admin needs to take it. */
export const SUPPORT_TOPICS = {
  wallet: 'users.money',
  bank: 'bank.ops',
  orders: 'orders.disputes',
  stores: 'stores.manage',
  agents: 'agents.manage',
  account: 'users.security',
  report: 'reports.manage',
  other: null,
} as const;
export type SupportTopic = keyof typeof SUPPORT_TOPICS;

type AdminRow = { id: string; admin_level: string | null; admin_permissions: string[] | null };
/**
 * Who may take a request: the super admin always; others need "support" and the topic's permission.
 * Without a topic (or "other"), only admins who hold every permission.
 */
export function canTake(a: AdminRow, topic: string | null) {
  if (a.admin_level === 'super_admin') return true;
  const perms = a.admin_permissions ?? [];
  if (!perms.includes('support')) return false;
  const need = topic ? SUPPORT_TOPICS[topic as SupportTopic] : null;
  return need ? perms.includes(need) : PERMISSIONS.every((p) => perms.includes(p));
}
async function adminRow(id: string) {
  return one<AdminRow & { role: string; full_name: string }>(`SELECT id, role, admin_level, admin_permissions, full_name FROM ${S}.users WHERE id = $1`, [id]);
}
/** Readers of a chat: its participants, and the super admin for any support chat (to review the team). */
async function canRead(conversationId: string, userId: string) {
  if (await one(`SELECT 1 FROM ${S}.conversation_participants WHERE conversation_id = $1 AND user_id = $2`, [conversationId, userId])) return 'participant';
  const c = await one<any>(`SELECT type FROM ${S}.conversations WHERE id = $1`, [conversationId]);
  const a = await adminRow(userId);
  if (c?.type === 'support' && a?.role === 'admin' && a.admin_level === 'super_admin') return 'supervisor';
  throw notFound('Conversation not found');
}

const LINK_RE = /https?:\/\/[^\s]+/;

/** Stores an (encrypted) message and tells the other participants — one notification per chat until they read it. */
export async function postMessage(conversationId: string, me: string, text: string, o: { replyTo?: string; kind?: 'text' | 'link'; meta?: Record<string, unknown> } = {}) {
  await participant(conversationId, me);
  const conv = await one<any>(`SELECT status, type FROM ${S}.conversations WHERE id = $1`, [conversationId]);
  if (conv?.status === 'closed') throw forbidden('This conversation is closed', 'CONVERSATION_CLOSED');
  if (conv?.type !== 'support') {
    const other = await one<any>(`SELECT user_id FROM ${S}.conversation_participants WHERE conversation_id = $1 AND user_id <> $2 LIMIT 1`, [conversationId, me]);
    if (other) await assertNotBlocked(me, String(other.user_id));
  }
  if (o.replyTo && !(await one(`SELECT 1 FROM ${S}.messages WHERE id = $1 AND conversation_id = $2`, [o.replyTo, conversationId]))) throw notFound('Message not found');
  const kind = o.kind ?? (LINK_RE.test(text) ? 'link' : 'text');
  const m = await one<any>(
    `INSERT INTO ${S}.messages (conversation_id, sender_id, content, is_edited, is_deleted, reply_to, kind, meta) VALUES ($1, $2, $3, false, false, $4, $5, $6)
     RETURNING id, created_at, reply_to, kind, meta, reactions`,
    [conversationId, me, encrypt(text, `msg:${conversationId}`), o.replyTo ?? null, kind, o.meta ? JSON.stringify(o.meta) : null],
  );
  await pool.query(
    `UPDATE ${S}.conversations SET updated_at = now(), last_message_at = now(),
            first_reply_at = CASE WHEN type = 'support' AND first_reply_at IS NULL AND assigned_to = $2 THEN now() ELSE first_reply_at END WHERE id = $1`,
    [conversationId, me],
  );
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
    await assertNotBlocked(String(me), String(target.id));
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
        WHERE (u.full_name ILIKE $1 OR lower(u.email) = lower($3) OR w.wallet_id = $3) AND u.id <> $2 AND u.role <> 'admin' AND u.status = 'active' AND NOT ${blockedSql('$2', 'u.id')}
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
      `SELECT c.id, c.type, c.title, c.status, c.created_at, c.updated_at, c.created_by, c.topic, c.assigned_to, c.closed_at,
              (SELECT full_name FROM ${S}.users WHERE id = c.assigned_to) AS assigned_name,
              (SELECT json_build_object('stars', r.stars, 'comment', r.comment, 'declined', r.declined) FROM ${S}.support_ratings r WHERE r.conversation_id = c.id AND r.user_id = $1) AS my_rating,
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
      .object({
        type: z.enum(['direct', 'user_to_user', 'support']),
        recipientId: idParam.optional(),
        title: z.string().trim().max(80).optional(),
        topic: z.enum(Object.keys(SUPPORT_TOPICS) as [SupportTopic, ...SupportTopic[]]).optional(),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const { type, recipientId, title } = req.body;
    if (type === 'support') {
      const topic = req.body.topic ?? null;
      const existing = await one<any>(
        `SELECT c.id, c.topic FROM ${S}.conversations c JOIN ${S}.conversation_participants p ON p.conversation_id = c.id
          WHERE p.user_id = $1 AND c.type = 'support' AND c.status = 'active' AND c.created_by = $1 LIMIT 1`,
        [me],
      );
      if (existing) {
        if (topic && !existing.topic) await pool.query(`UPDATE ${S}.conversations SET topic = $2 WHERE id = $1`, [existing.id, topic]);
        return res.json({ success: true, data: { conversationId: existing.id, existing: true } });
      }
      // Nobody is added yet: the request waits in the queue of the admins who may take it.
      const id = await tx(async (c) => {
        const conv = await one<any>(
          `INSERT INTO ${S}.conversations (type, title, created_by, status, topic) VALUES ('support', $2, $1, 'active', $3) RETURNING id`,
          [me, title || 'Support request', topic],
          c,
        );
        await c.query(`INSERT INTO ${S}.conversation_participants (conversation_id, user_id) VALUES ($1, $2)`, [conv.id, me]);
        return conv.id;
      });
      // Admins on leave or off support aren't alerted.
      const admins = await pool.query<AdminRow>(`SELECT id, admin_level, admin_permissions FROM ${S}.users u WHERE role = 'admin' AND status = 'active' AND id <> $1 AND NOT ${awaySql('u.id')}`, [me]);
      const who = await one<any>(`SELECT full_name FROM ${S}.users WHERE id = $1`, [me]);
      for (const a of admins.rows.filter((x) => canTake(x, topic)))
        await notifyBi(undefined, a.id, 'support_new', ['New support request', `${who?.full_name ?? ''} is waiting for help.`], ['طلب دعم جديد', `${who?.full_name ?? ''} بستنى مساعدة.`], {
          link: '/app/messages?queue=1',
        });
      return res.status(201).json({ success: true, data: { conversationId: id, existing: false } });
    }
    if (!recipientId) throw badRequest('RECIPIENT_REQUIRED', 'Choose who to message');
    if (String(recipientId) === String(me)) throw badRequest('SELF', 'You cannot message yourself');
    const target = await one<any>(`SELECT id, role, status FROM ${S}.users WHERE id = $1`, [recipientId]);
    if (!target || target.status !== 'active' || target.role === 'admin') throw notFound('User not found');
    await assertNotBlocked(String(me), String(target.id));
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
    const c = await one<any>(
      `UPDATE ${S}.conversations SET status = 'closed', updated_at = now(), closed_at = now(), closed_by = $2 WHERE id = $1 RETURNING type, created_by, assigned_to`,
      [req.params.id, req.auth!.userId],
    );
    // A support chat closed by the team: ask the customer how it went (they may say no).
    if (c?.type === 'support' && c.assigned_to && String(c.created_by) !== String(req.auth!.userId))
      await notifyBi(undefined, c.created_by, 'support_closed', ['Your support chat was closed', 'How did we do? Rate the help you got.'], ['انسكّرت محادثة الدعم', 'كيف كانت المساعدة؟ قيّمها إذا حابب.'], {
        conversationId: req.params.id,
      });
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
    const as = await canRead(req.params.id!, me);
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
    if (as === 'participant') await pool.query(`UPDATE ${S}.conversation_participants SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2`, [req.params.id, me]);
    res.json({
      success: true,
      data: {
        readOnly: as === 'supervisor',
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

// ------------------------------------------------------------ support desk
async function requireSupportAdmin(userId: string) {
  const a = await adminRow(userId);
  if (!a || a.role !== 'admin' || (a.admin_level !== 'super_admin' && !(a.admin_permissions ?? []).includes('support'))) throw forbidden('You do not have permission for this action', 'NO_PERMISSION');
  return a;
}
const supportCols = `c.id, c.topic, c.status, c.created_at, c.claimed_at, c.first_reply_at, c.closed_at, c.assigned_to,
  u.id AS customer_id, u.full_name AS customer_name, u.profile_image AS customer_image, u.role AS customer_role,
  (SELECT content FROM ${S}.messages m WHERE m.conversation_id = c.id AND NOT COALESCE(m.is_deleted,false) ORDER BY m.created_at DESC LIMIT 1) AS last_content,
  (SELECT count(*)::int FROM ${S}.messages m WHERE m.conversation_id = c.id AND NOT COALESCE(m.is_deleted,false)) AS messages`;

/** Requests nobody has taken yet that this admin may take. */
messagesRouter.get(
  '/support/queue',
  ah(async (req, res) => {
    const a = await requireSupportAdmin(req.auth!.userId);
    const r = await pool.query(
      `SELECT ${supportCols} FROM ${S}.conversations c JOIN ${S}.users u ON u.id = c.created_by
        WHERE c.type = 'support' AND c.status = 'active' AND c.assigned_to IS NULL AND c.created_by <> $1
        ORDER BY c.created_at LIMIT 100`,
      [a.id],
    );
    const items = r.rows
      .filter((x) => canTake(a, x.topic))
      .map(({ last_content, ...x }) => ({ ...x, last: last_content ? readMessage(last_content, String(x.id)).slice(0, 120) : null }));
    res.json({ success: true, data: { items } });
  }),
);

/** Take a request: it becomes yours alone and leaves everyone else's queue. */
messagesRouter.post(
  '/support/:id/claim',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const a = await requireSupportAdmin(req.auth!.userId);
    const conv = await one<any>(`SELECT topic, created_by FROM ${S}.conversations WHERE id = $1 AND type = 'support'`, [req.params.id]);
    if (!conv) throw notFound('Conversation not found');
    if (!canTake(a, conv.topic)) throw forbidden('This request is for another team', 'NOT_YOUR_TOPIC');
    const ok = await one(
      `UPDATE ${S}.conversations SET assigned_to = $2, claimed_at = now() WHERE id = $1 AND assigned_to IS NULL AND status = 'active' RETURNING id`,
      [req.params.id, a.id],
    );
    if (!ok) throw conflict('ALREADY_TAKEN', 'Someone else already took this request');
    await pool.query(
      `INSERT INTO ${S}.conversation_participants (conversation_id, user_id) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM ${S}.conversation_participants WHERE conversation_id = $1 AND user_id = $2)`,
      [req.params.id, a.id],
    );
    await notifyBi(undefined, conv.created_by, 'support_claimed', ['Someone is helping you', `${a.full_name} took your support request.`], ['في حدا عم يساعدك', `${a.full_name} استلم طلب الدعم تبعك.`], {
      conversationId: req.params.id,
    });
    res.json({ success: true, data: { conversationId: req.params.id } });
  }),
);

/** Give a request back to the queue (e.g. it needs another team). */
messagesRouter.post(
  '/support/:id/release',
  validate({
    params: z.object({ id: idParam }).strict(),
    body: z.object({ topic: z.enum(Object.keys(SUPPORT_TOPICS) as [SupportTopic, ...SupportTopic[]]).optional() }).strict(),
  }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const a = await requireSupportAdmin(me);
    const r = await one(
      `UPDATE ${S}.conversations SET assigned_to = NULL, claimed_at = NULL, topic = COALESCE($3, topic)
        WHERE id = $1 AND type = 'support' AND status = 'active' AND (assigned_to = $2 OR $4) RETURNING id`,
      [req.params.id, me, req.body.topic ?? null, a.admin_level === 'super_admin'],
    );
    if (!r) throw notFound('Conversation not found');
    await pool.query(
      `DELETE FROM ${S}.conversation_participants p USING ${S}.users u, ${S}.conversations c
        WHERE p.conversation_id = $1 AND u.id = p.user_id AND u.role = 'admin' AND c.id = p.conversation_id AND p.user_id <> c.created_by`,
      [req.params.id],
    );
    res.json({ success: true });
  }),
);

/**
 * Super admin: hand a chat — open or closed — to an admin, or take it yourself.
 * A closed chat opens again. The admin it goes to is told and either takes it or
 * asks for it to move, with a reason. Admins on leave can still get it, for when they're back.
 */
messagesRouter.post(
  '/support/:id/hand',
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ to: idParam, reason: z.string().trim().max(300).optional() }).strict() }),
  ah(async (req, res) => {
    const me = String(req.auth!.userId);
    const a = await adminRow(me);
    if (a?.admin_level !== 'super_admin') throw forbidden('Only the super admin can see every support chat', 'SUPER_ONLY');
    const to = await adminRow(req.body.to);
    if (!to || to.role !== 'admin' || (to.admin_level !== 'super_admin' && !(to.admin_permissions ?? []).includes('support')))
      throw badRequest('NOT_SUPPORT_ADMIN', 'This admin does not handle support');
    const c = await one<any>(`SELECT created_by, assigned_to, status FROM ${S}.conversations WHERE id = $1 AND type = 'support'`, [req.params.id]);
    if (!c) throw notFound('Conversation not found');
    const from = c.assigned_to ? String(c.assigned_to) : null;
    const self = String(to.id) === me;
    await tx(async (q) => {
      await q.query(
        `UPDATE ${S}.conversations SET assigned_to = $2, claimed_at = COALESCE(claimed_at, now()), status = 'active', closed_at = NULL, closed_by = NULL, updated_at = now() WHERE id = $1`,
        [req.params.id, to.id],
      );
      if (from && from !== String(to.id)) await q.query(`DELETE FROM ${S}.conversation_participants WHERE conversation_id = $1 AND user_id = $2`, [req.params.id, from]);
      await q.query(
        `INSERT INTO ${S}.conversation_participants (conversation_id, user_id) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM ${S}.conversation_participants WHERE conversation_id = $1 AND user_id = $2)`,
        [req.params.id, to.id],
      );
      await q.query(`UPDATE ${S}.support_handoffs SET status = 'replaced', decided_at = now() WHERE conversation_id = $1 AND status = 'pending'`, [req.params.id]);
      await q.query(`INSERT INTO ${S}.support_handoffs (conversation_id, from_admin, to_admin, reason, status, decided_at) VALUES ($1, $2, $3, $4, $5, $6)`, [
        req.params.id,
        me,
        to.id,
        req.body.reason ?? null,
        self ? 'accepted' : 'pending',
        self ? new Date() : null,
      ]);
    });
    if (!self)
      await notifyBi(
        undefined,
        to.id,
        'support_handoff',
        ['A support chat was handed to you', `${a.full_name}: ${req.body.reason || 'please carry on with it'} — take it, or ask to move it.`],
        ['انحوّلتلك محادثة دعم', `${a.full_name}: ${req.body.reason || 'كمّل فيها'} — استلمها أو اطلب تحويلها.`],
        { link: '/app/messages?queue=1' },
      );
    if (from && from !== String(to.id) && from !== me)
      await notifyBi(undefined, from, 'support_moved', ['A support chat moved', `${a.full_name} moved one of your support chats to ${to.full_name}.`], ['محادثة دعم انتقلت', `${a.full_name} نقل محادثة دعم من عندك لـ ${to.full_name}.`], {
        conversationId: req.params.id,
      });
    if (from !== String(to.id) || c.status === 'closed')
      await notifyBi(undefined, c.created_by, 'support_claimed', ['Someone is helping you', `${to.full_name} is carrying on with your request.`], ['في حدا عم يساعدك', `${to.full_name} رح يكمّل معك طلبك.`], {
        conversationId: req.params.id,
      });
    res.json({ success: true, data: { assignedTo: to.id, name: to.full_name, reopened: c.status === 'closed' } });
  }),
);

/** Chats handed to me that I haven't answered yet. */
messagesRouter.get(
  '/support/handoffs',
  ah(async (req, res) => {
    const r = await pool.query(
      `SELECT h.id, h.conversation_id, h.reason, h.created_at, f.full_name AS from_name, c.topic, u.full_name AS customer_name, u.profile_image AS customer_image
         FROM ${S}.support_handoffs h JOIN ${S}.conversations c ON c.id = h.conversation_id JOIN ${S}.users u ON u.id = c.created_by
         LEFT JOIN ${S}.users f ON f.id = h.from_admin
        WHERE h.to_admin = $1 AND h.status = 'pending' AND c.assigned_to = $1 ORDER BY h.created_at`,
      [req.auth!.userId],
    );
    res.json({ success: true, data: { items: r.rows } });
  }),
);

/** Take a handed chat, or ask the super admin to move it — saying why. */
messagesRouter.post(
  '/support/handoffs/:id',
  validate({
    params: z.object({ id: idParam }).strict(),
    body: z
      .object({ action: z.enum(['accept', 'decline']), answer: z.string().trim().max(300).optional() })
      .strict()
      .refine((b) => b.action === 'accept' || (b.answer && b.answer.length >= 3), 'Say why it should move'),
  }),
  ah(async (req, res) => {
    const me = String(req.auth!.userId);
    const h = await one<any>(
      `UPDATE ${S}.support_handoffs SET status = $3, answer = $4, decided_at = now() WHERE id = $1 AND to_admin = $2 AND status = 'pending' RETURNING conversation_id, from_admin`,
      [req.params.id, me, req.body.action === 'accept' ? 'accepted' : 'declined', req.body.answer ?? null],
    );
    if (!h) throw notFound('Not found');
    const u = await adminRow(me);
    if (h.from_admin && String(h.from_admin) !== me)
      await notifyBi(
        undefined,
        h.from_admin,
        'support_handoff',
        req.body.action === 'accept' ? [`${u?.full_name} took the chat`, ''] : [`${u?.full_name} asked to move a chat`, req.body.answer ?? ''],
        req.body.action === 'accept' ? [`${u?.full_name} استلم المحادثة`, ''] : [`${u?.full_name} طلب تحويل محادثة`, req.body.answer ?? ''],
        { link: '/app/admin/team?tab=chats' },
      );
    res.json({ success: true, data: { conversationId: h.conversation_id } });
  }),
);

/** The customer rates the help they got (or says they'd rather not). One rating per chat; it can be changed. */
messagesRouter.post(
  '/conversations/:id/rate',
  validate({
    params: z.object({ id: idParam }).strict(),
    body: z
      .object({ stars: z.number().int().min(1).max(5).optional(), comment: z.string().trim().max(500).optional(), declined: z.boolean().default(false) })
      .strict()
      .refine((b) => b.declined || b.stars, 'Choose a number of stars'),
  }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const c = await one<any>(`SELECT created_by, assigned_to FROM ${S}.conversations WHERE id = $1 AND type = 'support'`, [req.params.id]);
    if (!c || String(c.created_by) !== String(me)) throw notFound('Conversation not found');
    if (!c.assigned_to) throw badRequest('NOT_HANDLED', 'Nobody has answered this request yet');
    await pool.query(
      `INSERT INTO ${S}.support_ratings (conversation_id, admin_id, user_id, stars, comment, declined) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (conversation_id) DO UPDATE SET stars = EXCLUDED.stars, comment = EXCLUDED.comment, declined = EXCLUDED.declined, updated_at = now()`,
      [req.params.id, c.assigned_to, me, req.body.declined ? null : req.body.stars, req.body.declined ? null : req.body.comment || null, req.body.declined],
    );
    res.json({ success: true });
  }),
);

/** Super admin: every support chat, who handled it and how it was rated. */
messagesRouter.get(
  '/support/all',
  validate({ query: z.object({ admin: idParam.optional(), status: z.enum(['waiting', 'active', 'closed']).optional() }).strict() }),
  ah(async (req, res) => {
    const a = await adminRow(req.auth!.userId);
    if (a?.admin_level !== 'super_admin') throw forbidden('Only the super admin can see every support chat', 'SUPER_ONLY');
    const q = req.query as any;
    const r = await pool.query(
      `SELECT ${supportCols}, h.full_name AS admin_name, h.profile_image AS admin_image, sr.stars, sr.comment, sr.declined,
              (SELECT json_build_object('status', x.status, 'reason', x.reason, 'answer', x.answer, 'to_name', t.full_name, 'at', COALESCE(x.decided_at, x.created_at))
                 FROM ${S}.support_handoffs x JOIN ${S}.users t ON t.id = x.to_admin WHERE x.conversation_id = c.id ORDER BY x.created_at DESC LIMIT 1) AS handoff
         FROM ${S}.conversations c JOIN ${S}.users u ON u.id = c.created_by
         LEFT JOIN ${S}.users h ON h.id = c.assigned_to LEFT JOIN ${S}.support_ratings sr ON sr.conversation_id = c.id
        WHERE c.type = 'support' AND ($1::uuid IS NULL OR c.assigned_to = $1)
          AND ($2::text IS NULL OR ($2 = 'waiting' AND c.assigned_to IS NULL AND c.status = 'active') OR ($2 = 'active' AND c.assigned_to IS NOT NULL AND c.status = 'active') OR ($2 = 'closed' AND c.status = 'closed'))
        ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT 200`,
      [q.admin ?? null, q.status ?? null],
    );
    res.json({ success: true, data: { items: r.rows.map(({ last_content, ...x }) => ({ ...x, last: last_content ? readMessage(last_content, String(x.id)).slice(0, 120) : null })) } });
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

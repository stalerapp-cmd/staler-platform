import { Router } from 'express';
import { z } from 'zod';
import { one, pool, S, tx } from '../lib/db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { uuid, validate } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { isSuper, requirePerm } from '../lib/permissions.js';
import { notify } from './ledger.js';
import { awaySql, leaveJson } from './leaves.js';

/**
 * Support chat inside the bank app. Every customer has one conversation with the
 * bank. When they write, it waits in the team queue until one staff member takes
 * it; from then on only that person answers (the super admin reads everything,
 * and can take it over or hand it to someone else — even a closed one, which opens
 * again). The person it's handed to takes it or asks for it to move, saying why.
 * When it's closed the customer is asked to rate the help.
 */
export const supportRouter = Router();
supportRouter.use(requireAuth);

export const TOPICS = ['account', 'transfers', 'wallet', 'scheduled', 'security', 'other'] as const;
const body = z.object({ body: z.string().trim().min(1, 'Write a message').max(2000), topic: z.enum(TOPICS).optional() }).strict();

const messages = (userId: string) =>
  pool.query(
    `SELECT m.id, m.body, m.from_staff, m.created_at, m.read_at, s.full_name AS staff_name
       FROM ${S}.support_messages m LEFT JOIN ${S}.users s ON s.id = m.staff_id
      WHERE m.user_id = $1 ORDER BY m.created_at DESC LIMIT 300`,
    [userId],
  );
const threadOf = (userId: string) =>
  one<any>(
    `SELECT t.*, a.full_name AS assigned_name FROM ${S}.support_threads t LEFT JOIN ${S}.users a ON a.id = t.assigned_to WHERE t.user_id = $1`,
    [userId],
  );

/** Staff who can answer, and are not on leave. */
const supportStaff = (except?: string) =>
  pool.query<{ id: string }>(
    `SELECT u.id FROM ${S}.users u WHERE u.role = 'admin' AND u.status = 'active' AND (u.admin_level = 'super_admin' OR 'support' = ANY(u.admin_permissions))
        AND NOT ${awaySql('u.id')} AND ($1::uuid IS NULL OR u.id <> $1)`,
    [except ?? null],
  );

// ----------------------------------------------------------------- customer
supportRouter.get(
  '/support',
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const r = await messages(me);
    await pool.query(`UPDATE ${S}.support_messages SET read_at = now() WHERE user_id = $1 AND from_staff AND read_at IS NULL`, [me]);
    const t = await threadOf(me);
    res.json({
      success: true,
      data: { messages: r.rows.reverse(), thread: t ? { status: t.status, topic: t.topic, assignedName: t.assigned_name, ratingPending: t.rating_pending } : null },
    });
  }),
);

supportRouter.get(
  '/support/unread',
  ah(async (req, res) => {
    const r = await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.support_messages WHERE user_id = $1 AND from_staff AND read_at IS NULL`, [req.auth!.userId]);
    res.json({ success: true, data: { unread: r?.n ?? 0 } });
  }),
);

supportRouter.post(
  '/support',
  validate({ body }),
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    const before = await threadOf(userId);
    const fresh = !before || before.status === 'closed';
    const m = await tx(async (c) => {
      const msg = await one<any>(`INSERT INTO ${S}.support_messages (user_id, body) VALUES ($1, $2) RETURNING id, body, from_staff, created_at`, [userId, req.body.body], c);
      await c.query(
        `INSERT INTO ${S}.support_threads (user_id, topic, status, created_at, updated_at) VALUES ($1, $2, 'open', now(), now())
         ON CONFLICT (user_id) DO UPDATE SET updated_at = now(), rating_pending = false,
           status = 'open', topic = COALESCE($2, CASE WHEN ${S}.support_threads.status = 'closed' THEN NULL ELSE ${S}.support_threads.topic END),
           assigned_to = CASE WHEN ${S}.support_threads.status = 'closed' THEN NULL ELSE ${S}.support_threads.assigned_to END,
           claimed_at = CASE WHEN ${S}.support_threads.status = 'closed' THEN NULL ELSE ${S}.support_threads.claimed_at END,
           first_reply_at = CASE WHEN ${S}.support_threads.status = 'closed' THEN NULL ELSE ${S}.support_threads.first_reply_at END,
           closed_at = NULL, closed_by = NULL`,
        [userId, req.body.topic ?? null],
      );
      return msg;
    });
    const t = await threadOf(userId);
    const who = await one<{ full_name: string }>(`SELECT full_name FROM ${S}.users WHERE id = $1`, [userId]);
    const link = `/app/admin/support/${userId}`;
    if (t?.assigned_to) {
      await notify(undefined, t.assigned_to, 'support_message', 'New support message', `${who?.full_name ?? 'A customer'} wrote`, { link, ar: { title: 'رسالة دعم جديدة', body: `${who?.full_name ?? 'زبون'} كتب` } });
    } else if (fresh) {
      // A new request: tell the team once; the first to take it gets it.
      for (const s of (await supportStaff()).rows)
        await notify(undefined, s.id, 'support_message', 'New support request', `${who?.full_name ?? 'A customer'} is waiting in the queue`, {
          link,
          ar: { title: 'طلب دعم جديد', body: `${who?.full_name ?? 'زبون'} بستنى بالطابور` },
        });
    }
    res.status(201).json({ success: true, data: { message: m } });
  }),
);

/** The customer rates the help after a conversation is closed (or says they'd rather not). */
supportRouter.post(
  '/support/rating',
  validate({ body: z.object({ stars: z.number().int().min(1).max(5).nullable(), comment: z.string().trim().max(500).optional() }).strict() }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const t = await one<any>(`UPDATE ${S}.support_threads SET rating_pending = false WHERE user_id = $1 AND rating_pending RETURNING closed_by`, [me]);
    if (!t) throw notFound('Not found');
    if (req.body.stars) await pool.query(`INSERT INTO ${S}.support_ratings (user_id, admin_id, stars, comment) VALUES ($1, $2, $3, $4)`, [me, t.closed_by, req.body.stars, req.body.comment ?? null]);
    res.json({ success: true });
  }),
);

// ----------------------------------------------------------------- staff
const staff = [requireRole('admin'), requirePerm('support')];

supportRouter.get(
  '/admin/support',
  ...staff,
  validate({ query: z.object({ view: z.enum(['queue', 'mine', 'all']).default('queue'), admin: uuid.optional(), status: z.enum(['open', 'closed']).optional() }).strict() }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const q = req.query as any;
    const sup = isSuper(req);
    if (q.view === 'all' && !sup) throw forbidden('Only the super admin can see every support chat', 'SUPER_ONLY');
    const r = await pool.query(
      `SELECT t.user_id, t.topic, t.status, t.assigned_to, t.claimed_at, t.closed_at, t.updated_at, a.full_name AS assigned_name,
              u.full_name, u.email, u.customer_type, l.body AS last_body, l.created_at AS last_at, l.from_staff AS last_from_staff,
              (SELECT count(*)::int FROM ${S}.support_messages x WHERE x.user_id = u.id AND NOT x.from_staff AND x.read_at IS NULL) AS unread,
              (SELECT json_build_object('status', h.status, 'reason', h.reason, 'answer', h.answer, 'to_name', tt.full_name)
                 FROM ${S}.support_handoffs h JOIN ${S}.users tt ON tt.id = h.to_admin WHERE h.user_id = t.user_id ORDER BY h.created_at DESC LIMIT 1) AS handoff,
              (SELECT stars FROM ${S}.support_ratings sr WHERE sr.user_id = t.user_id ORDER BY sr.created_at DESC LIMIT 1) AS stars
         FROM ${S}.support_threads t JOIN ${S}.users u ON u.id = t.user_id LEFT JOIN ${S}.users a ON a.id = t.assigned_to
         LEFT JOIN LATERAL (SELECT body, created_at, from_staff FROM ${S}.support_messages WHERE user_id = t.user_id ORDER BY created_at DESC LIMIT 1) l ON true
        WHERE CASE $1 WHEN 'queue' THEN t.status = 'open' AND t.assigned_to IS NULL WHEN 'mine' THEN t.assigned_to = $2 ELSE true END
          AND ($3::uuid IS NULL OR t.assigned_to = $3) AND ($4::text IS NULL OR t.status = $4)
        ORDER BY (t.status = 'open') DESC, t.updated_at DESC LIMIT 300`,
      [q.view, me, q.admin ?? null, q.status ?? null],
    );
    const counts = await one<any>(
      `SELECT count(*) FILTER (WHERE status = 'open' AND assigned_to IS NULL)::int AS queue, count(*) FILTER (WHERE status = 'open' AND assigned_to = $1)::int AS mine FROM ${S}.support_threads`,
      [me],
    );
    res.json({ success: true, data: { threads: r.rows, counts, isSuper: sup } });
  }),
);

/** Read a conversation: waiting ones and your own; the super admin reads any. */
supportRouter.get(
  '/admin/support/:userId',
  ...staff,
  validate({ params: z.object({ userId: uuid }).strict() }),
  ah(async (req, res) => {
    const me = String(req.auth!.userId);
    const u = await one<any>(`SELECT id, full_name, email, customer_type, business_name FROM ${S}.users WHERE id = $1`, [req.params.userId]);
    if (!u) throw notFound('Customer not found');
    const t = await threadOf(u.id);
    const mine = t?.assigned_to && String(t.assigned_to) === me;
    if (t?.assigned_to && !mine && !isSuper(req)) throw forbidden('Another team member is handling this chat', 'NOT_YOURS');
    const r = await messages(u.id);
    if (mine || !t?.assigned_to) await pool.query(`UPDATE ${S}.support_messages SET read_at = now() WHERE user_id = $1 AND NOT from_staff AND read_at IS NULL`, [u.id]);
    const handoff = await one<any>(
      `SELECT h.id, h.status, h.reason, h.answer, h.to_admin, tt.full_name AS to_name, f.full_name AS from_name FROM ${S}.support_handoffs h JOIN ${S}.users tt ON tt.id = h.to_admin LEFT JOIN ${S}.users f ON f.id = h.from_admin
        WHERE h.user_id = $1 ORDER BY h.created_at DESC LIMIT 1`,
      [u.id],
    );
    res.json({ success: true, data: { customer: u, thread: t, handoff, messages: r.rows.reverse(), mine: !!mine, isSuper: isSuper(req) } });
  }),
);

/** Reply. A waiting conversation becomes yours with your first reply. */
supportRouter.post(
  '/admin/support/:userId',
  ...staff,
  validate({ params: z.object({ userId: uuid }).strict(), body }),
  ah(async (req, res) => {
    const me = String(req.auth!.userId);
    const u = await one<any>(`SELECT id FROM ${S}.users WHERE id = $1`, [req.params.userId]);
    if (!u) throw notFound('Customer not found');
    const t = await one<any>(
      `INSERT INTO ${S}.support_threads (user_id, status, assigned_to, claimed_at) VALUES ($1, 'open', $2, now())
       ON CONFLICT (user_id) DO UPDATE SET assigned_to = COALESCE(${S}.support_threads.assigned_to, $2), claimed_at = COALESCE(${S}.support_threads.claimed_at, now())
       RETURNING assigned_to, status`,
      [u.id, me],
    );
    if (String(t.assigned_to) !== me) throw forbidden('Another team member is handling this chat', 'NOT_YOURS');
    if (t.status === 'closed') throw forbidden('This conversation is closed', 'CONVERSATION_CLOSED');
    const m = await one<any>(
      `INSERT INTO ${S}.support_messages (user_id, from_staff, staff_id, body) VALUES ($1, true, $2, $3) RETURNING id, body, from_staff, created_at`,
      [u.id, me, req.body.body],
    );
    await pool.query(`UPDATE ${S}.support_threads SET first_reply_at = COALESCE(first_reply_at, now()), updated_at = now() WHERE user_id = $1`, [u.id]);
    await pool.query(`UPDATE ${S}.support_handoffs SET status = 'accepted', decided_at = now() WHERE user_id = $1 AND to_admin = $2 AND status = 'pending'`, [u.id, me]);
    await notify(undefined, u.id, 'support_reply', 'Support replied', req.body.body.slice(0, 140), { link: '/app/support', ar: { title: 'ردّ الدعم عليك', body: req.body.body.slice(0, 140) } });
    res.status(201).json({ success: true, data: { message: m } });
  }),
);

supportRouter.post(
  '/admin/support/:userId/claim',
  ...staff,
  validate({ params: z.object({ userId: uuid }).strict() }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const t = await one<any>(`UPDATE ${S}.support_threads SET assigned_to = $2, claimed_at = now() WHERE user_id = $1 AND status = 'open' AND assigned_to IS NULL RETURNING user_id`, [req.params.userId, me]);
    if (!t) throw badRequest('ALREADY_TAKEN', 'Someone already took this chat');
    const n = await one<any>(`SELECT full_name FROM ${S}.users WHERE id = $1`, [me]);
    await notify(undefined, req.params.userId!, 'support_claimed', 'Someone is helping you', `${n?.full_name} is looking at your request.`, { link: '/app/support', ar: { title: 'في حدا عم يساعدك', body: `${n?.full_name} استلم طلبك.` } });
    res.json({ success: true });
  }),
);

supportRouter.post(
  '/admin/support/:userId/release',
  ...staff,
  validate({ params: z.object({ userId: uuid }).strict() }),
  ah(async (req, res) => {
    const t = await one(`UPDATE ${S}.support_threads SET assigned_to = NULL, claimed_at = NULL WHERE user_id = $1 AND assigned_to = $2 AND status = 'open' RETURNING user_id`, [req.params.userId, req.auth!.userId]);
    if (!t) throw notFound('Not found');
    for (const s of (await supportStaff(req.auth!.userId)).rows)
      await notify(undefined, s.id, 'support_message', 'A support request is back in the queue', '', { link: `/app/admin/support/${req.params.userId}`, ar: { title: 'طلب دعم رجع للطابور', body: '' } });
    res.json({ success: true });
  }),
);

supportRouter.post(
  '/admin/support/:userId/close',
  ...staff,
  validate({ params: z.object({ userId: uuid }).strict() }),
  ah(async (req, res) => {
    const me = String(req.auth!.userId);
    const t = await one<any>(`SELECT assigned_to, status FROM ${S}.support_threads WHERE user_id = $1`, [req.params.userId]);
    if (!t || t.status === 'closed') throw notFound('Not found');
    if (String(t.assigned_to ?? '') !== me && !isSuper(req)) throw forbidden('Another team member is handling this chat', 'NOT_YOURS');
    await pool.query(`UPDATE ${S}.support_threads SET status = 'closed', closed_at = now(), closed_by = COALESCE(assigned_to, $2), rating_pending = true, updated_at = now() WHERE user_id = $1`, [req.params.userId, me]);
    await notify(undefined, req.params.userId!, 'support_closed', 'Your support chat was closed', 'How was the help? Rate it in Support.', {
      link: '/app/support',
      ar: { title: 'تسكّرت محادثة الدعم', body: 'كيف كانت المساعدة؟ قيّمها من صفحة الدعم.' },
    });
    res.json({ success: true });
  }),
);

/**
 * Super admin: hand a conversation — open or closed — to a staff member, or take it.
 * The person it goes to takes it or asks to move it; staff on leave can still get it.
 */
supportRouter.post(
  '/admin/support/:userId/hand',
  ...staff,
  validate({ params: z.object({ userId: uuid }).strict(), body: z.object({ to: uuid, reason: z.string().trim().max(300).optional() }).strict() }),
  ah(async (req, res) => {
    if (!isSuper(req)) throw forbidden('Only the super admin can see every support chat', 'SUPER_ONLY');
    const me = String(req.auth!.userId);
    const to = await one<any>(`SELECT id, full_name, role, admin_level, admin_permissions FROM ${S}.users WHERE id = $1`, [req.body.to]);
    if (!to || to.role !== 'admin' || (to.admin_level !== 'super_admin' && !(to.admin_permissions ?? []).includes('support'))) throw badRequest('NOT_SUPPORT_ADMIN', 'This admin does not handle support');
    const t = await threadOf(req.params.userId!);
    if (!t) throw notFound('Conversation not found');
    const self = String(to.id) === me;
    const from = t.assigned_to ? String(t.assigned_to) : null;
    await tx(async (c) => {
      await c.query(
        `UPDATE ${S}.support_threads SET assigned_to = $2, claimed_at = COALESCE(claimed_at, now()), status = 'open', closed_at = NULL, closed_by = NULL, rating_pending = false, updated_at = now() WHERE user_id = $1`,
        [t.user_id, to.id],
      );
      await c.query(`UPDATE ${S}.support_handoffs SET status = 'replaced', decided_at = now() WHERE user_id = $1 AND status = 'pending'`, [t.user_id]);
      await c.query(`INSERT INTO ${S}.support_handoffs (user_id, from_admin, to_admin, reason, status, decided_at) VALUES ($1, $2, $3, $4, $5, $6)`, [
        t.user_id,
        me,
        to.id,
        req.body.reason ?? null,
        self ? 'accepted' : 'pending',
        self ? new Date() : null,
      ]);
    });
    const a = await one<any>(`SELECT full_name FROM ${S}.users WHERE id = $1`, [me]);
    if (!self)
      await notify(undefined, to.id, 'support_handoff', 'A support chat was handed to you', `${a?.full_name}: ${req.body.reason || 'please carry on with it'} — take it, or ask to move it.`, {
        link: `/app/admin/support/${t.user_id}`,
        ar: { title: 'انحوّلتلك محادثة دعم', body: `${a?.full_name}: ${req.body.reason || 'كمّل فيها'} — استلمها أو اطلب تحويلها.` },
      });
    if (from && from !== String(to.id) && from !== me)
      await notify(undefined, from, 'support_moved', 'A support chat moved', `${a?.full_name} moved it to ${to.full_name}.`, { ar: { title: 'محادثة دعم انتقلت', body: `${a?.full_name} نقلها لـ ${to.full_name}.` } });
    if (from !== String(to.id) || t.status === 'closed')
      await notify(undefined, t.user_id, 'support_claimed', 'Someone is helping you', `${to.full_name} is carrying on with your request.`, { link: '/app/support', ar: { title: 'في حدا عم يساعدك', body: `${to.full_name} رح يكمّل معك طلبك.` } });
    await audit({ userId: me, action: 'admin.support_handed', entityType: 'user', entityId: t.user_id, details: { to: to.id } }, req);
    res.json({ success: true, data: { reopened: t.status === 'closed' } });
  }),
);

/** Chats handed to me that I haven't answered yet. */
supportRouter.get(
  '/admin/support-handoffs',
  ...staff,
  ah(async (req, res) => {
    const r = await pool.query(
      `SELECT h.id, h.user_id, h.reason, h.created_at, f.full_name AS from_name, u.full_name AS customer_name, t.topic
         FROM ${S}.support_handoffs h JOIN ${S}.support_threads t ON t.user_id = h.user_id JOIN ${S}.users u ON u.id = h.user_id LEFT JOIN ${S}.users f ON f.id = h.from_admin
        WHERE h.to_admin = $1 AND h.status = 'pending' AND t.assigned_to = $1 ORDER BY h.created_at`,
      [req.auth!.userId],
    );
    res.json({ success: true, data: { items: r.rows } });
  }),
);

supportRouter.post(
  '/admin/support-handoffs/:id',
  ...staff,
  validate({
    params: z.object({ id: uuid }).strict(),
    body: z
      .object({ action: z.enum(['accept', 'decline']), answer: z.string().trim().max(300).optional() })
      .strict()
      .refine((b) => b.action === 'accept' || (b.answer && b.answer.length >= 3), 'Say why it should move'),
  }),
  ah(async (req, res) => {
    const me = String(req.auth!.userId);
    const h = await one<any>(
      `UPDATE ${S}.support_handoffs SET status = $3, answer = $4, decided_at = now() WHERE id = $1 AND to_admin = $2 AND status = 'pending' RETURNING user_id, from_admin`,
      [req.params.id, me, req.body.action === 'accept' ? 'accepted' : 'declined', req.body.answer ?? null],
    );
    if (!h) throw notFound('Not found');
    const u = await one<any>(`SELECT full_name FROM ${S}.users WHERE id = $1`, [me]);
    if (h.from_admin && String(h.from_admin) !== me)
      await notify(
        undefined,
        h.from_admin,
        'support_handoff',
        req.body.action === 'accept' ? `${u?.full_name} took the chat` : `${u?.full_name} asked to move a chat`,
        req.body.answer ?? '',
        { link: `/app/admin/support/${h.user_id}`, ar: { title: req.body.action === 'accept' ? `${u?.full_name} استلم المحادثة` : `${u?.full_name} طلب تحويل محادثة`, body: req.body.answer ?? '' } },
      );
    res.json({ success: true, data: { userId: h.user_id } });
  }),
);

/** Super admin: how each staff member does on support. */
supportRouter.get(
  '/admin/support-team',
  requireRole('admin'),
  ah(async (req, res) => {
    if (!isSuper(req)) throw forbidden('Only the super admin can see every support chat', 'SUPER_ONLY');
    const r = await pool.query(
      `SELECT a.id, a.full_name, a.email, a.admin_level, a.admin_permissions, a.last_login_at, ${leaveJson('a.id')} AS leave,
              (SELECT count(*)::int FROM ${S}.support_threads t WHERE t.assigned_to = a.id AND t.status = 'open') AS open_now,
              (SELECT count(*)::int FROM ${S}.support_threads t WHERE (t.assigned_to = a.id OR t.closed_by = a.id) AND t.claimed_at > now() - interval '30 days') AS taken_30d,
              (SELECT count(*)::int FROM ${S}.support_messages m WHERE m.staff_id = a.id AND m.created_at > now() - interval '30 days') AS replies_30d,
              (SELECT round(avg(extract(epoch FROM (t.first_reply_at - t.created_at)) / 60))::int FROM ${S}.support_threads t WHERE t.closed_by = a.id OR t.assigned_to = a.id) AS first_reply_min,
              (SELECT round(avg(stars)::numeric, 1)::text FROM ${S}.support_ratings r WHERE r.admin_id = a.id) AS stars,
              (SELECT count(*)::int FROM ${S}.support_ratings r WHERE r.admin_id = a.id) AS ratings
         FROM ${S}.users a WHERE a.role = 'admin' AND a.status = 'active' ORDER BY (a.admin_level = 'super_admin') DESC, a.full_name`,
    );
    const recent = await pool.query(
      `SELECT r.stars, r.comment, r.created_at, u.full_name AS customer, a.full_name AS admin_name FROM ${S}.support_ratings r JOIN ${S}.users u ON u.id = r.user_id LEFT JOIN ${S}.users a ON a.id = r.admin_id
        WHERE r.comment IS NOT NULL ORDER BY r.created_at DESC LIMIT 20`,
    );
    res.json({ success: true, data: { admins: r.rows, comments: recent.rows } });
  }),
);

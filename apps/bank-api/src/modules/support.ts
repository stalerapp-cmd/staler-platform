import { Router } from 'express';
import { z } from 'zod';
import { one, pool, S } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { uuid, validate } from '../lib/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requirePerm } from '../lib/permissions.js';
import { notify } from './ledger.js';

/**
 * Support chat inside the bank app: every customer has one thread with the
 * bank's staff. Customers read and write their own thread; staff with the
 * `support` permission see every thread and answer.
 */
export const supportRouter = Router();
supportRouter.use(requireAuth);

const body = z.object({ body: z.string().trim().min(1, 'Write a message').max(2000) }).strict();

const thread = (userId: string) =>
  pool.query(
    `SELECT m.id, m.body, m.from_staff, m.created_at, m.read_at, s.full_name AS staff_name
       FROM ${S}.support_messages m LEFT JOIN ${S}.users s ON s.id = m.staff_id
      WHERE m.user_id = $1 ORDER BY m.created_at DESC LIMIT 200`,
    [userId],
  );

supportRouter.get(
  '/support',
  ah(async (req, res) => {
    const r = await thread(req.auth!.userId);
    await pool.query(`UPDATE ${S}.support_messages SET read_at = now() WHERE user_id = $1 AND from_staff AND read_at IS NULL`, [req.auth!.userId]);
    res.json({ success: true, data: { messages: r.rows.reverse() } });
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
    const m = await one<any>(`INSERT INTO ${S}.support_messages (user_id, body) VALUES ($1, $2) RETURNING id, body, from_staff, created_at`, [userId, req.body.body]);
    // Tell the staff who can answer — once per waiting conversation, not for every line.
    const waiting = await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.support_messages WHERE user_id = $1 AND NOT from_staff AND read_at IS NULL`, [userId]);
    if ((waiting?.n ?? 0) <= 1) {
      const who = await one<{ full_name: string }>(`SELECT full_name FROM ${S}.users WHERE id = $1`, [userId]);
      const staff = await pool.query(
        `SELECT id FROM ${S}.users WHERE role = 'admin' AND status = 'active' AND (admin_level = 'super_admin' OR 'support' = ANY(admin_permissions))`,
      );
      for (const s of staff.rows)
        await notify(undefined, s.id, 'support_message', 'New support message', `${who?.full_name ?? 'A customer'} wrote to support`, {
          link: `/app/admin/support/${userId}`,
          ar: { title: 'رسالة دعم جديدة', body: `${who?.full_name ?? 'زبون'} كتب للدعم` },
        });
    }
    res.status(201).json({ success: true, data: { message: m } });
  }),
);

// ----------------------------------------------------------------- staff
supportRouter.get(
  '/admin/support',
  requireRole('admin'),
  requirePerm('support'),
  ah(async (_req, res) => {
    const r = await pool.query(
      `SELECT u.id AS user_id, u.full_name, u.email, u.profile_image, l.body AS last_body, l.created_at AS last_at, l.from_staff AS last_from_staff,
              (SELECT count(*)::int FROM ${S}.support_messages x WHERE x.user_id = u.id AND NOT x.from_staff AND x.read_at IS NULL) AS unread
         FROM (SELECT DISTINCT user_id FROM ${S}.support_messages) t
         JOIN ${S}.users u ON u.id = t.user_id
         JOIN LATERAL (SELECT body, created_at, from_staff FROM ${S}.support_messages WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) l ON true
        ORDER BY (SELECT count(*) FROM ${S}.support_messages x WHERE x.user_id = u.id AND NOT x.from_staff AND x.read_at IS NULL) > 0 DESC, l.created_at DESC
        LIMIT 200`,
    );
    res.json({ success: true, data: { threads: r.rows } });
  }),
);

supportRouter.get(
  '/admin/support/:userId',
  requireRole('admin'),
  requirePerm('support'),
  validate({ params: z.object({ userId: uuid }).strict() }),
  ah(async (req, res) => {
    const u = await one<any>(`SELECT id, full_name, email, profile_image FROM ${S}.users WHERE id = $1`, [req.params.userId]);
    if (!u) throw notFound('Customer not found');
    const r = await thread(u.id);
    await pool.query(`UPDATE ${S}.support_messages SET read_at = now() WHERE user_id = $1 AND NOT from_staff AND read_at IS NULL`, [u.id]);
    res.json({ success: true, data: { customer: u, messages: r.rows.reverse() } });
  }),
);

supportRouter.post(
  '/admin/support/:userId',
  requireRole('admin'),
  requirePerm('support'),
  validate({ params: z.object({ userId: uuid }).strict(), body }),
  ah(async (req, res) => {
    const u = await one<any>(`SELECT id FROM ${S}.users WHERE id = $1`, [req.params.userId]);
    if (!u) throw notFound('Customer not found');
    const m = await one<any>(
      `INSERT INTO ${S}.support_messages (user_id, from_staff, staff_id, body) VALUES ($1, true, $2, $3) RETURNING id, body, from_staff, created_at`,
      [u.id, req.auth!.userId, req.body.body],
    );
    await notify(undefined, u.id, 'support_reply', 'Support replied', req.body.body.slice(0, 140), {
      link: '/app/support',
      ar: { title: 'ردّ الدعم عليك', body: req.body.body.slice(0, 140) },
    });
    res.status(201).json({ success: true, data: { message: m } });
  }),
);

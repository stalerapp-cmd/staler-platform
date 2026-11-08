import { Router } from 'express';
import { z } from 'zod';
import { one, pool, S } from '../lib/db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { validate } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { requireAuth } from '../middleware/auth.js';
import { notify } from './ledger.js';

/**
 * Admin leave. Any admin asks for time off; the super admin approves or declines,
 * or puts an admin on leave / off support directly. While away, an admin gets no
 * new-request alerts, and the handover list shows it under their name — work can
 * still be handed to them for when they are back.
 */
const idParam = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid id');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date');

/** SQL: the admin `col` is away today (approved leave or off). */
export const awaySql = (col: string) =>
  `EXISTS (SELECT 1 FROM ${S}.admin_leaves l WHERE l.admin_id = ${col} AND l.status = 'approved' AND (now() AT TIME ZONE 'Asia/Hebron')::date BETWEEN l.starts_on AND l.ends_on)`;

/** SQL: this admin's current or next approved leave, as JSON (or null). */
export const leaveJson = (col: string) =>
  `(SELECT json_build_object('kind', l.kind, 'starts_on', l.starts_on, 'ends_on', l.ends_on, 'reason', l.reason)
      FROM ${S}.admin_leaves l WHERE l.admin_id = ${col} AND l.status = 'approved' AND l.ends_on >= (now() AT TIME ZONE 'Asia/Hebron')::date
     ORDER BY l.starts_on LIMIT 1)`;

async function me(id: string) {
  const u = await one<any>(`SELECT id, role, admin_level, full_name FROM ${S}.users WHERE id = $1`, [id]);
  if (!u || u.role !== 'admin') throw forbidden('You do not have permission for this action', 'NO_PERMISSION');
  return { ...u, isSuper: u.admin_level === 'super_admin' };
}

async function tellSupers(except: string, en: [string, string], ar: [string, string]) {
  const s = await pool.query(`SELECT id FROM ${S}.users WHERE role = 'admin' AND admin_level = 'super_admin' AND status = 'active' AND id <> $1`, [except]);
  for (const r of s.rows) await notify(undefined, r.id, 'admin_leave', en[0], en[1], { link: '/app/admin/leaves', ar: { title: ar[0], body: ar[1] } });
}

const cols = `l.id, l.admin_id, l.kind, l.starts_on, l.ends_on, l.reason, l.status, l.note, l.created_at, l.decided_at,
  a.full_name AS admin_name, a.profile_image AS admin_image, d.full_name AS decided_by_name, r.full_name AS requested_by_name`;
const from = `FROM ${S}.admin_leaves l JOIN ${S}.users a ON a.id = l.admin_id LEFT JOIN ${S}.users d ON d.id = l.decided_by LEFT JOIN ${S}.users r ON r.id = l.requested_by`;

export const leavesRouter = Router();
leavesRouter.use(requireAuth);

leavesRouter.get(
  '/',
  ah(async (req, res) => {
    const u = await me(req.auth!.userId);
    const r = await pool.query(
      `SELECT ${cols} ${from} WHERE ($2 OR l.admin_id = $1) AND (l.status IN ('requested', 'approved') OR l.created_at > now() - interval '90 days')
        ORDER BY (l.status = 'requested') DESC, l.starts_on DESC LIMIT 200`,
      [u.id, u.isSuper],
    );
    const admins = u.isSuper
      ? (await pool.query(`SELECT a.id, a.full_name, a.profile_image, a.admin_level, ${leaveJson('a.id')} AS leave FROM ${S}.users a WHERE a.role = 'admin' AND a.status = 'active' ORDER BY a.full_name`)).rows
      : [];
    res.json({ success: true, data: { leaves: r.rows, admins, isSuper: u.isSuper } });
  }),
);

const range = (b: { startsOn: string; endsOn: string }) => {
  if (b.endsOn < b.startsOn) throw badRequest('BAD_RANGE', 'The last day is before the first');
};

/** Ask for time off. */
leavesRouter.post(
  '/',
  validate({ body: z.object({ startsOn: day, endsOn: day, reason: z.string().trim().min(2).max(300) }).strict() }),
  ah(async (req, res) => {
    const u = await me(req.auth!.userId);
    range(req.body);
    const l = await one<any>(
      `INSERT INTO ${S}.admin_leaves (admin_id, kind, starts_on, ends_on, reason, status, requested_by) VALUES ($1, 'leave', $2, $3, $4, $5, $1) RETURNING id`,
      [u.id, req.body.startsOn, req.body.endsOn, req.body.reason, u.isSuper ? 'approved' : 'requested'],
    );
    if (!u.isSuper)
      await tellSupers(u.id, [`${u.full_name} asked for leave`, `${req.body.startsOn} → ${req.body.endsOn}: ${req.body.reason}`], [`${u.full_name} طلب إجازة`, `${req.body.startsOn} ← ${req.body.endsOn}: ${req.body.reason}`]);
    await audit({ userId: u.id, action: 'admin.leave_requested', entityType: 'admin_leave', entityId: l.id }, req);
    res.status(201).json({ success: true, data: { id: l.id } });
  }),
);

/** Super admin: put an admin on leave, or off support, from now or for given days. */
leavesRouter.post(
  '/set',
  validate({ body: z.object({ adminId: idParam, kind: z.enum(['leave', 'off']), startsOn: day, endsOn: day, reason: z.string().trim().max(300).optional() }).strict() }),
  ah(async (req, res) => {
    const u = await me(req.auth!.userId);
    if (!u.isSuper) throw forbidden('Only the super admin can do this', 'SUPER_ONLY');
    range(req.body);
    const a = await one<any>(`SELECT id FROM ${S}.users WHERE id = $1 AND role = 'admin'`, [req.body.adminId]);
    if (!a) throw notFound('User not found');
    const l = await one<any>(
      `INSERT INTO ${S}.admin_leaves (admin_id, kind, starts_on, ends_on, reason, status, requested_by, decided_by, decided_at) VALUES ($1, $2, $3, $4, $5, 'approved', $6, $6, now()) RETURNING id`,
      [a.id, req.body.kind, req.body.startsOn, req.body.endsOn, req.body.reason ?? null, u.id],
    );
    const off = req.body.kind === 'off';
    const span = `${req.body.startsOn} → ${req.body.endsOn}${req.body.reason ? ` · ${req.body.reason}` : ''}`;
    await notify(undefined, a.id, 'admin_leave', off ? 'You are off support for a while' : 'You are on leave', span, {
      link: '/app/admin/leaves',
      ar: { title: off ? 'انوقفت عن الدعم لفترة' : 'صرت بإجازة', body: span },
    });
    await audit({ userId: u.id, action: 'admin.leave_set', entityType: 'admin_leave', entityId: l.id, details: { admin: a.id, kind: req.body.kind } }, req);
    res.status(201).json({ success: true, data: { id: l.id } });
  }),
);

leavesRouter.post(
  '/:id/decide',
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional() }).strict() }),
  ah(async (req, res) => {
    const u = await me(req.auth!.userId);
    if (!u.isSuper) throw forbidden('Only the super admin can do this', 'SUPER_ONLY');
    const l = await one<any>(
      `UPDATE ${S}.admin_leaves SET status = $2, note = $3, decided_by = $4, decided_at = now() WHERE id = $1 AND status = 'requested' RETURNING admin_id, starts_on, ends_on`,
      [req.params.id, req.body.approve ? 'approved' : 'declined', req.body.note ?? null, u.id],
    );
    if (!l) throw notFound('Not found');
    const when = `${String(l.starts_on).slice(0, 10)}`;
    await notify(undefined, l.admin_id, 'admin_leave', req.body.approve ? 'Your leave was approved' : 'Your leave was declined', req.body.note ?? when, {
      link: '/app/admin/leaves',
      ar: { title: req.body.approve ? 'انقبلت إجازتك' : 'ما انقبلت إجازتك', body: req.body.note ?? when },
    });
    await audit({ userId: u.id, action: req.body.approve ? 'admin.leave_approved' : 'admin.leave_declined', entityType: 'admin_leave', entityId: req.params.id! }, req);
    res.json({ success: true });
  }),
);

/** Cancel: your own request or leave, or (super admin) anyone's — e.g. to bring someone back early. */
leavesRouter.post(
  '/:id/cancel',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const u = await me(req.auth!.userId);
    const l = await one<any>(
      `UPDATE ${S}.admin_leaves SET status = 'cancelled', decided_by = $2, decided_at = now()
        WHERE id = $1 AND status IN ('requested', 'approved') AND (admin_id = $2 OR $3) RETURNING admin_id`,
      [req.params.id, u.id, u.isSuper],
    );
    if (!l) throw notFound('Not found');
    if (String(l.admin_id) !== String(u.id))
      await notify(undefined, l.admin_id, 'admin_leave', 'Your leave was ended', `${u.full_name} ended it.`, { link: '/app/admin/leaves', ar: { title: 'انتهت إجازتك', body: `${u.full_name} أنهاها.` } });
    res.json({ success: true });
  }),
);

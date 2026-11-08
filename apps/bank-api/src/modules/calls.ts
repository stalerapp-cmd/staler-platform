import { Router } from 'express';
import { z } from 'zod';
import { one, pool, S } from '../lib/db.js';
import { badRequest, conflict, forbidden, notFound, tooMany } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { validate } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { requireAuth } from '../middleware/auth.js';
import { TOPICS } from './support.js';
import { notify } from './ledger.js';
import { awaySql } from './leaves.js';
import { logger } from '../lib/logger.js';

/**
 * Support calls.
 *
 * A customer asks for a call and says what it's about; a support admin accepts (or
 * declines) and the customer books a time within the team's hours. An admin can
 * also ask someone for a call. At the booked time the admin calls (or shows the
 * customer a "Call" button they can hide again).
 *
 * The call itself is WebRTC in the browser/app; this server only relays the
 * handshake (offer, answer, network candidates) between the two people.
 */
export const callsRouter = Router();

async function notifyBi(_c: undefined, userId: string, type: string, en: [string, string], ar: [string, string], meta: Record<string, unknown> = {}) {
  await notify(undefined, userId, type, en[0], en[1], { ...meta, ar: { title: ar[0], body: ar[1] } });
}
/** The bank has no per-topic support roles: anyone with support can take any call. */
const canTake = (a: any, _topic?: string | null) => a.admin_level === 'super_admin' || (a.admin_permissions ?? []).includes('support');
callsRouter.use(requireAuth);

// --------------------------------------------------------- network routes
/**
 * The ICE servers a call may use. STUN finds the direct path; TURN credentials
 * (short-lived, from the call server at ICE_URL) carry the call when a network
 * blocks the direct path. Cached for half the credentials' life.
 */
const STUN_ONLY = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }], source: 'stun' };
let iceCache: { at: number; ttl: number; body: any } | null = null;
export async function iceServers() {
  const url = process.env.ICE_URL;
  if (!url) return STUN_ONLY;
  if (iceCache && Date.now() - iceCache.at < (iceCache.ttl * 1000) / 2) return iceCache.body;
  try {
    const r = await fetch(url, { headers: process.env.ICE_SECRET ? { authorization: `Bearer ${process.env.ICE_SECRET}` } : {}, signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error(`ice ${r.status}`);
    const b = (await r.json()) as { iceServers: unknown[]; ttl?: number; source?: string };
    if (!Array.isArray(b.iceServers) || !b.iceServers.length) throw new Error('ice: empty');
    const body = { iceServers: b.iceServers, source: b.source ?? 'turn' };
    if (!iceCache) logger.info({ source: body.source }, 'call relay ready');
    iceCache = { at: Date.now(), ttl: Math.max(600, Number(b.ttl) || 3600), body };
    return body;
  } catch (e) {
    logger.warn({ err: String(e) }, 'call relay unreachable, using STUN only');
    return iceCache?.body ?? STUN_ONLY;
  }
}

callsRouter.get(
  '/ice',
  ah(async (_req, res) => {
    res.json({ success: true, data: await iceServers() });
  }),
);

const idParam = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid id');
const TOPIC = z.enum(TOPICS);
type Hours = { days: number[]; from: string; to: string; slot: number };
const TZ = 'Asia/Hebron';

async function me(id: string) {
  return one<any>(`SELECT id, role, admin_level, admin_permissions, full_name, profile_image FROM ${S}.users WHERE id = $1`, [id]);
}
const isSupport = (u: any) => u?.role === 'admin' && (u.admin_level === 'super_admin' || (u.admin_permissions ?? []).includes('support'));
async function hours(): Promise<Hours> {
  const r = await one<any>(`SELECT value FROM ${S}.settings WHERE key = 'call_hours'`);
  return r?.value ?? { days: [0, 1, 2, 3, 4, 6], from: '09:00', to: '17:00', slot: 30 };
}

/** Free times in the next 14 days within the team's hours (minus booked ones). */
async function freeSlots() {
  const h = await hours();
  const taken = new Set(
    (await pool.query(`SELECT slot_at FROM ${S}.call_requests WHERE status = 'scheduled' AND slot_at > now()`)).rows.map((r) => new Date(r.slot_at).toISOString()),
  );
  const out: string[] = [];
  const [fh, fm] = h.from.split(':').map(Number) as [number, number];
  const [th, tm] = h.to.split(':').map(Number) as [number, number];
  const now = Date.now();
  for (let d = 0; d < 14 && out.length < 400; d++) {
    // Local date in Palestine for day d.
    const local = new Date(new Date(now + d * 86400000).toLocaleString('en-US', { timeZone: TZ }));
    if (!h.days.includes(local.getDay())) continue;
    for (let mins = fh * 60 + fm; mins + h.slot <= th * 60 + tm; mins += h.slot) {
      const iso = localToUtc(local.getFullYear(), local.getMonth(), local.getDate(), Math.floor(mins / 60), mins % 60);
      if (new Date(iso).getTime() < now + 30 * 60_000 || taken.has(iso)) continue;
      out.push(iso);
    }
  }
  return { hours: h, slots: out };
}
/** A wall-clock time in Palestine as a UTC ISO string. */
function localToUtc(y: number, m: number, d: number, hh: number, mm: number) {
  const guess = Date.UTC(y, m, d, hh, mm);
  const asLocal = new Date(new Date(guess).toLocaleString('en-US', { timeZone: TZ })).getTime();
  const offset = asLocal - new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  return new Date(guess - offset).toISOString();
}

const REQ_COLS = `r.*, u.full_name AS user_name, u.profile_image AS user_image, u.role AS user_role, a.full_name AS admin_name, a.profile_image AS admin_image`;
const REQ_FROM = `FROM ${S}.call_requests r JOIN ${S}.users u ON u.id = r.user_id LEFT JOIN ${S}.users a ON a.id = r.admin_id`;

// ---------------------------------------------------------------- requests
callsRouter.get(
  '/hours',
  ah(async (_req, res) => {
    res.json({ success: true, data: await freeSlots() });
  }),
);

callsRouter.put(
  '/hours',
  validate({
    body: z
      .object({
        days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
        from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        slot: z.number().int().min(10).max(120),
      })
      .strict()
      .refine((b) => b.from < b.to, 'The day must end after it starts'),
  }),
  ah(async (req, res) => {
    const u = await me(req.auth!.userId);
    if (!isSupport(u)) throw forbidden('You do not have permission for this action', 'NO_PERMISSION');
    await pool.query(`INSERT INTO ${S}.settings (key, value, updated_at) VALUES ('call_hours', $1, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify({ ...req.body, days: [...new Set(req.body.days)].sort() })]);
    res.json({ success: true });
  }),
);

/** A customer asks for a call (and says what about). */
callsRouter.post(
  '/requests',
  validate({
    body: z
      .object({
        description: z.string().trim().min(10, 'Tell us a little more (10 characters or more)').max(1000),
        topic: TOPIC.optional(),
        /** Admins only: ask this person for a call. */
        userId: idParam.optional(),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const u = await me(req.auth!.userId);
    if (req.body.userId) {
      if (!isSupport(u)) throw forbidden('You do not have permission for this action', 'NO_PERMISSION');
      const target = await one<any>(`SELECT id FROM ${S}.users WHERE id = $1 AND status = 'active' AND role = 'user'`, [req.body.userId]);
      if (!target) throw notFound('User not found');
      const r = await one<any>(
        `INSERT INTO ${S}.call_requests (user_id, admin_id, initiated_by, topic, description, status) VALUES ($1, $2, 'admin', $3, $4, 'accepted') RETURNING id`,
        [target.id, u.id, req.body.topic ?? null, req.body.description],
      );
      await notifyBi(undefined, target.id, 'call_invite', ['The support team asks for a call', req.body.description], ['فريق الدعم بطلب مكالمة معك', req.body.description], { link: '/app/support?calls=1' });
      await audit({ userId: u.id, action: 'admin.call_requested', entityType: 'user', entityId: target.id }, req);
      return res.status(201).json({ success: true, data: { id: r.id } });
    }
    const open = await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.call_requests WHERE user_id = $1 AND status IN ('requested', 'accepted', 'scheduled')`, [u.id]);
    if ((open?.n ?? 0) >= 2) throw tooMany('You already have an open call request', 'CALL_OPEN');
    const r = await one<any>(`INSERT INTO ${S}.call_requests (user_id, topic, description) VALUES ($1, $2, $3) RETURNING id`, [u.id, req.body.topic ?? null, req.body.description]);
    const admins = await pool.query(`SELECT u.id, u.admin_level, u.admin_permissions FROM ${S}.users u WHERE u.role = 'admin' AND u.status = 'active' AND NOT ${awaySql('u.id')}`);
    for (const a of admins.rows.filter((x) => canTake(x, req.body.topic ?? null)))
      await notifyBi(undefined, a.id, 'call_request', ['New call request', `${u.full_name}: ${req.body.description.slice(0, 80)}`], ['طلب مكالمة جديد', `${u.full_name}: ${req.body.description.slice(0, 80)}`], {
        link: '/app/admin/calls',
      });
    res.status(201).json({ success: true, data: { id: r.id } });
  }),
);

/** Mine (customer), or the team's view (support admins). */
callsRouter.get(
  '/requests',
  validate({ query: z.object({ scope: z.enum(['mine', 'queue', 'scheduled', 'closed']).default('mine') }).strict() }),
  ah(async (req, res) => {
    const u = await me(req.auth!.userId);
    const scope = (req.query as any).scope;
    if (scope === 'mine') {
      const r = await pool.query(`SELECT ${REQ_COLS} ${REQ_FROM} WHERE r.user_id = $1 ORDER BY r.created_at DESC LIMIT 30`, [u.id]);
      return res.json({ success: true, data: { requests: r.rows } });
    }
    if (!isSupport(u)) throw forbidden('You do not have permission for this action', 'NO_PERMISSION');
    const where =
      scope === 'queue'
        ? `r.status = 'requested'`
        : scope === 'scheduled'
          ? `r.status IN ('accepted', 'scheduled', 'missed') AND (r.admin_id = $1 OR $2)`
          : `r.status IN ('done', 'cancelled', 'declined') AND (r.admin_id = $1 OR $2)`;
    const r = await pool.query(`SELECT ${REQ_COLS} ${REQ_FROM} WHERE ${where} ORDER BY COALESCE(r.slot_at, r.created_at) LIMIT 100`, scope === 'queue' ? [] : [u.id, u.admin_level === 'super_admin']);
    const rows = scope === 'queue' ? r.rows.filter((x) => canTake(u, x.topic)) : r.rows;
    res.json({ success: true, data: { requests: rows } });
  }),
);

async function reqFor(id: string, userId: string) {
  const r = await one<any>(`SELECT * FROM ${S}.call_requests WHERE id = $1`, [id]);
  if (!r) throw notFound('Call request not found');
  const u = await me(userId);
  const mine = String(r.user_id) === String(userId);
  const staff = isSupport(u) && (!r.admin_id || String(r.admin_id) === String(userId) || u.admin_level === 'super_admin');
  if (!mine && !staff) throw notFound('Call request not found');
  return { r, u, mine, staff };
}

/** The team answers a request: accept (the customer then books a time) or decline. */
callsRouter.post(
  '/requests/:id/answer',
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ accept: z.boolean(), note: z.string().trim().max(300).optional() }).strict() }),
  ah(async (req, res) => {
    const { r, u, staff } = await reqFor(req.params.id!, req.auth!.userId);
    if (!staff) throw forbidden('You do not have permission for this action', 'NO_PERMISSION');
    const ok = await one(
      `UPDATE ${S}.call_requests SET status = $2, admin_id = $3, note = $4, updated_at = now() WHERE id = $1 AND status = 'requested' RETURNING id`,
      [r.id, req.body.accept ? 'accepted' : 'declined', u.id, req.body.note ?? null],
    );
    if (!ok) throw conflict('ALREADY_TAKEN', 'Someone else already took this request');
    await notifyBi(
      undefined,
      r.user_id,
      'call_answer',
      req.body.accept ? ['Your call request was accepted', 'Pick a time that suits you.'] : ['Your call request was declined', req.body.note ?? ''],
      req.body.accept ? ['انقبل طلب المكالمة', 'اختار وقت بناسبك.'] : ['ما انقبل طلب المكالمة', req.body.note ?? 'بنقدر نكمّل بالرسائل.'],
      { link: '/app/support?calls=1' },
    );
    res.json({ success: true });
  }),
);

/** The customer books (or re-books) a time. */
callsRouter.post(
  '/requests/:id/slot',
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ at: z.string().datetime() }).strict() }),
  ah(async (req, res) => {
    const { r, mine } = await reqFor(req.params.id!, req.auth!.userId);
    if (!mine) throw forbidden('You do not have permission for this action', 'NO_PERMISSION');
    if (!['accepted', 'scheduled', 'missed'].includes(r.status)) throw conflict('CALL_CLOSED', 'This call request is closed');
    const { slots } = await freeSlots();
    const at = new Date(req.body.at).toISOString();
    if (!slots.includes(at) && !(r.slot_at && new Date(r.slot_at).toISOString() === at)) throw badRequest('SLOT_TAKEN', 'This time isn’t free — pick another');
    await pool.query(`UPDATE ${S}.call_requests SET status = 'scheduled', slot_at = $2, updated_at = now() WHERE id = $1`, [r.id, at]);
    if (r.admin_id)
      await notifyBi(undefined, r.admin_id, 'call_booked', ['A call was booked', at], ['انحجز موعد مكالمة', new Date(at).toLocaleString('ar-PS', { timeZone: TZ })], { link: '/app/admin/calls' });
    res.json({ success: true });
  }),
);

/** Show or hide the customer's "Call" button; mark done; the customer can cancel (or ask to). */
callsRouter.patch(
  '/requests/:id',
  validate({
    params: z.object({ id: idParam }).strict(),
    body: z.object({ buttonVisible: z.boolean().optional(), status: z.enum(['done', 'cancelled']).optional(), note: z.string().trim().max(300).optional() }).strict(),
  }),
  ah(async (req, res) => {
    const { r, mine, staff } = await reqFor(req.params.id!, req.auth!.userId);
    if (req.body.buttonVisible !== undefined && !staff) throw forbidden('You do not have permission for this action', 'NO_PERMISSION');
    if (req.body.status === 'done' && !staff) throw forbidden('You do not have permission for this action', 'NO_PERMISSION');
    await pool.query(
      `UPDATE ${S}.call_requests SET button_visible = COALESCE($2, button_visible), status = COALESCE($3, status), note = COALESCE($4, note),
              cancel_requested = CASE WHEN $3 = 'cancelled' AND $5 THEN true ELSE cancel_requested END, updated_at = now() WHERE id = $1`,
      [r.id, req.body.buttonVisible ?? null, req.body.status ?? null, req.body.note ?? null, mine],
    );
    if (req.body.status === 'cancelled' && mine && r.admin_id)
      await notifyBi(undefined, r.admin_id, 'call_cancelled', ['A call was cancelled', 'The customer says it’s sorted.'], ['انلغت مكالمة', 'الزبون بقول انحلّت القصة.'], { link: '/app/admin/calls' });
    if (req.body.buttonVisible && !mine)
      await notifyBi(undefined, r.user_id, 'call_ready', ['You can call support now', 'Open your call and press Call.'], ['بتقدر تتصل بالدعم هلّأ', 'افتح المكالمة واكبس «اتصل».'], { link: '/app/support?calls=1' });
    res.json({ success: true });
  }),
);

// ---------------------------------------------------------------- sessions
const SESSION_TTL = 45_000;

/** Start a call for a request: the admin calls the customer, or the customer calls when the button is shown. */
callsRouter.post(
  '/sessions',
  validate({ body: z.object({ requestId: idParam, video: z.boolean().default(false) }).strict() }),
  ah(async (req, res) => {
    const { r, mine, staff } = await reqFor(req.body.requestId, req.auth!.userId);
    if (!['accepted', 'scheduled', 'missed'].includes(r.status)) throw conflict('CALL_CLOSED', 'This call request is closed');
    if (mine && !r.button_visible) throw forbidden('The team will call you at the booked time', 'CALL_NOT_OPEN');
    const callee = mine ? r.admin_id : r.user_id;
    if (!callee) throw badRequest('NO_AGENT', 'Nobody from the team has taken this request yet');
    if (staff && !r.admin_id) await pool.query(`UPDATE ${S}.call_requests SET admin_id = $2 WHERE id = $1`, [r.id, req.auth!.userId]);
    await pool.query(`UPDATE ${S}.call_sessions SET status = 'ended', ended_at = now() WHERE request_id = $1 AND status IN ('ringing', 'active')`, [r.id]);
    const s = await one<any>(`INSERT INTO ${S}.call_sessions (request_id, caller_id, callee_id, video) VALUES ($1, $2, $3, $4) RETURNING id`, [r.id, req.auth!.userId, callee, req.body.video]);
    res.status(201).json({ success: true, data: { id: s.id, calleeId: callee } });
  }),
);

/** Is someone calling me? (polled by the app) */
callsRouter.get(
  '/incoming',
  ah(async (req, res) => {
    await pool.query(
      `UPDATE ${S}.call_sessions SET status = 'missed', ended_at = now() WHERE status = 'ringing' AND created_at < now() - make_interval(secs => $1)`,
      [SESSION_TTL / 1000],
    );
    const s = await one<any>(
      `SELECT s.id, s.video, s.request_id, s.created_at, u.full_name AS caller_name, u.profile_image AS caller_image, u.role AS caller_role
         FROM ${S}.call_sessions s JOIN ${S}.users u ON u.id = s.caller_id WHERE s.callee_id = $1 AND s.status = 'ringing' ORDER BY s.created_at DESC LIMIT 1`,
      [req.auth!.userId],
    );
    res.json({ success: true, data: { call: s } });
  }),
);

async function party(sessionId: string, userId: string) {
  const s = await one<any>(`SELECT * FROM ${S}.call_sessions WHERE id = $1`, [sessionId]);
  if (!s || (String(s.caller_id) !== String(userId) && String(s.callee_id) !== String(userId))) throw notFound('Call not found');
  return { s, other: String(s.caller_id) === String(userId) ? s.callee_id : s.caller_id };
}

callsRouter.get(
  '/sessions/:id',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const { s, other } = await party(req.params.id!, req.auth!.userId);
    const o = await one<any>(`SELECT full_name, profile_image, role FROM ${S}.users WHERE id = $1`, [other]);
    res.json({ success: true, data: { session: { ...s, other: o } } });
  }),
);

/** Answer, decline or hang up. */
callsRouter.patch(
  '/sessions/:id',
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ status: z.enum(['active', 'declined', 'ended']) }).strict() }),
  ah(async (req, res) => {
    const { s } = await party(req.params.id!, req.auth!.userId);
    const st = req.body.status;
    if (st === 'active' && (s.status !== 'ringing' || String(s.callee_id) !== String(req.auth!.userId))) throw conflict('CALL_GONE', 'This call has ended');
    await pool.query(
      `UPDATE ${S}.call_sessions SET status = $2, answered_at = CASE WHEN $2 = 'active' THEN now() ELSE answered_at END,
              ended_at = CASE WHEN $2 <> 'active' THEN now() ELSE ended_at END WHERE id = $1`,
      [s.id, st],
    );
    // A call that never connected leaves the request open to book again.
    if (st !== 'active' && !s.answered_at && s.request_id)
      await pool.query(`UPDATE ${S}.call_requests SET status = 'missed', updated_at = now() WHERE id = $1 AND status = 'scheduled'`, [s.request_id]);
    res.json({ success: true });
  }),
);

/** Relay one handshake message (offer, answer, candidate, bye) to the other person. */
callsRouter.post(
  '/sessions/:id/signal',
  validate({
    params: z.object({ id: idParam }).strict(),
    body: z.object({ kind: z.enum(['offer', 'answer', 'ice', 'bye', 'media']), payload: z.unknown() }).strict(),
  }),
  ah(async (req, res) => {
    const { s, other } = await party(req.params.id!, req.auth!.userId);
    if (['ended', 'missed', 'declined'].includes(s.status) && req.body.kind !== 'bye') throw conflict('CALL_GONE', 'This call has ended');
    if (JSON.stringify(req.body.payload ?? null).length > 20000) throw badRequest('TOO_LARGE', 'Too large');
    await pool.query(`INSERT INTO ${S}.call_relay (session_id, to_user, kind, payload) VALUES ($1, $2, $3, $4)`, [s.id, other, req.body.kind, JSON.stringify(req.body.payload ?? null)]);
    res.json({ success: true });
  }),
);

callsRouter.get(
  '/sessions/:id/signals',
  validate({ params: z.object({ id: idParam }).strict(), query: z.object({ after: z.coerce.number().int().min(0).default(0) }).strict() }),
  ah(async (req, res) => {
    const { s } = await party(req.params.id!, req.auth!.userId);
    const r = await pool.query(`SELECT id, kind, payload FROM ${S}.call_relay WHERE session_id = $1 AND to_user = $2 AND id > $3 ORDER BY id LIMIT 100`, [
      s.id,
      req.auth!.userId,
      (req.query as any).after,
    ]);
    res.json({ success: true, data: { status: s.status, signals: r.rows } });
  }),
);

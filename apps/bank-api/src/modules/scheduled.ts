import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { env } from '../config/env.js';
import { one, pool, S, tx } from '../lib/db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { amountSchema } from '../lib/money.js';
import { totpCode, uuid, validate } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { requirePerm } from '../lib/permissions.js';
import { requireAuth } from '../middleware/auth.js';
import { moneyLimiter } from '../middleware/security.js';
import { assertDailyLimit, assertMaxTransfer, move, notify } from './ledger.js';
import { requireSecondFactor } from './mfa.js';
import { maskName, ownAccount, resolveRecipient } from './banking.js';

/**
 * Scheduled payments (standing orders) and blocking, the bank side.
 * A payment goes from one of your accounts to someone's account — once, or every
 * week / two weeks / month / N days, forever, until a date or for N payments.
 * The receiver accepts first; they can decline and stop you asking again.
 * It is sent by itself (or only reminded), with a reminder N days before.
 * A block stops transfers, QR payments and scheduled payments between two people.
 */

// ------------------------------------------------------------------ blocks
export const blockedSql = (a: string, b: string) =>
  `EXISTS (SELECT 1 FROM ${S}.user_blocks ub WHERE (ub.blocker_id = ${a} AND ub.blocked_id = ${b}) OR (ub.blocker_id = ${b} AND ub.blocked_id = ${a}))`;

export async function assertNotBlocked(a: string, b: string, c?: pg.PoolClient) {
  if (!a || !b || String(a) === String(b)) return;
  const r = await one<any>(`SELECT ${blockedSql('$1::uuid', '$2::uuid')} AS x`, [a, b], c);
  if (r?.x) throw forbidden('You can’t deal with this account', 'BLOCKED');
}

// ------------------------------------------------------------------ helpers
const EVERY = ['once', 'week', '2weeks', 'month', 'days'] as const;
const interval = (p = 'o') => `CASE ${p}.every WHEN 'week' THEN interval '7 days' WHEN '2weeks' THEN interval '14 days' WHEN 'days' THEN make_interval(days => COALESCE(${p}.every_days, 1)) ELSE interval '1 month' END`;

async function tellBoth(o: any, en: [string, string], ar: [string, string], who: 'owner' | 'receiver' = 'owner') {
  await notify(undefined, who === 'owner' ? o.user_id : o.to_user_id, 'scheduled', en[0], en[1], { ar: { title: ar[0], body: ar[1] }, link: '/app/scheduled' });
}

/** After a payment (or a skip): count it, move the date, finish when it's done. */
async function advance(o: any, counted: boolean) {
  const r = await one<any>(
    `UPDATE ${S}.standing_orders o SET runs = runs + $2::int, total = total + CASE WHEN $2::int = 1 THEN amount ELSE 0 END, awaiting = false, fail_count = 0,
            last_run_at = CASE WHEN $2::int = 1 THEN now() ELSE last_run_at END,
            next_run_at = GREATEST(next_run_at, now() - interval '1 minute') + ${interval()}
      WHERE id = $1 RETURNING *`,
    [o.id, counted ? 1 : 0],
  );
  if (!r) return;
  const done = r.every === 'once' || (r.ends === 'count' && r.runs >= r.max_runs) || (r.ends === 'until' && r.end_date && new Date(r.next_run_at) > new Date(`${String(r.end_date).slice(0, 10)}T23:59:59Z`));
  if (done) {
    await pool.query(`UPDATE ${S}.standing_orders SET active = false, finished_at = now() WHERE id = $1`, [r.id]);
    await tellBoth(r, ['A scheduled payment finished', `${r.title ?? ''} — ${r.runs} payments`], ['خلصت دفعة مجدولة', `${r.title ?? ''} — ${r.runs} دفعة`]);
  }
}

async function deliver(o: any): Promise<{ ok: boolean; error?: string; code?: string }> {
  try {
    const t = await tx(async (c) => {
      assertMaxTransfer(String(o.amount));
      await assertDailyLimit(c, o.user_id, String(o.amount));
      return move(c, {
        fromAccountId: o.from_account_id,
        toAccountId: o.to_account_id,
        amount: Number(o.amount).toFixed(2),
        type: 'transfer',
        subject: o.title || 'Scheduled payment',
        initiatedBy: o.user_id,
        metadata: { standingOrder: o.id },
      });
    });
    await pool.query(`INSERT INTO ${S}.standing_order_runs (order_id, user_id, amount, status, transaction_id) VALUES ($1, $2, $3, 'done', $4)`, [o.id, o.user_id, o.amount, t.id]);
    await notify(undefined, o.to_user_id, 'transfer_in', 'Money received', `You received ${Number(o.amount).toFixed(2)} ${env.CURRENCY}`, { transactionId: t.id });
    return { ok: true };
  } catch (e: any) {
    await pool.query(`INSERT INTO ${S}.standing_order_runs (order_id, user_id, amount, status, error) VALUES ($1, $2, $3, 'failed', $4)`, [o.id, o.user_id, o.amount, String(e?.message ?? e).slice(0, 200)]);
    return { ok: false, error: e?.message, code: e?.code };
  }
}

/** Reminders N days before (0 = a few hours before), once per date. */
async function remind() {
  const r = await pool.query(
    `SELECT o.*, u.full_name AS to_name FROM ${S}.standing_orders o JOIN ${S}.users u ON u.id = o.to_user_id
      WHERE o.active AND NOT o.paused_by_admin AND o.consent = 'accepted' AND o.remind_before IS NOT NULL
        AND (o.reminded_for IS NULL OR o.reminded_for <> o.next_run_at)
        AND o.next_run_at - CASE WHEN o.remind_before = 0 THEN interval '3 hours' ELSE make_interval(days => o.remind_before) END <= now()
        AND o.next_run_at > now()`,
  );
  for (const o of r.rows) {
    await pool.query(`UPDATE ${S}.standing_orders SET reminded_for = next_run_at WHERE id = $1`, [o.id]);
    const amt = `${Number(o.amount).toFixed(2)} ${env.CURRENCY}`;
    await tellBoth(
      o,
      [o.auto ? 'A scheduled payment goes out soon' : 'A payment is due soon', `${amt} to ${o.to_name}${o.title ? ` — ${o.title}` : ''}`],
      [o.auto ? 'دفعة مجدولة رح تنبعت قريب' : 'في دفعة لازم تدفعها قريب', `${amt} لـ ${o.to_name}${o.title ? ` — ${o.title}` : ''}`],
    );
  }
}

/** Runs what is due. `only` limits it to some orders (right after creating or accepting). */
export async function runScheduled(only?: string[]) {
  if (!only) await remind();
  const due = await pool.query(
    `SELECT o.* FROM ${S}.standing_orders o
      WHERE o.active AND NOT o.paused_by_admin AND NOT o.awaiting AND o.consent = 'accepted' AND o.next_run_at <= now() + interval '1 minute'
        AND ($1::uuid[] IS NULL OR o.id = ANY($1)) ORDER BY o.next_run_at LIMIT 200`,
    [only ?? null],
  );
  for (const o of due.rows) {
    if (!o.auto && !only) {
      await pool.query(`UPDATE ${S}.standing_orders SET awaiting = true WHERE id = $1`, [o.id]);
      await tellBoth(o, ['A payment is due', `${Number(o.amount).toFixed(2)} ${env.CURRENCY} — pay it with one tap.`], ['حان موعد دفعة', `${Number(o.amount).toFixed(2)} ${env.CURRENCY} — ادفعها بكبسة.`]);
      continue;
    }
    if (!o.auto) continue;
    const claimed = await one(`UPDATE ${S}.standing_orders SET next_run_at = next_run_at + interval '1 second' WHERE id = $1 AND next_run_at = $2 RETURNING id`, [o.id, o.next_run_at]);
    if (!claimed) continue;
    const r = await deliver(o);
    if (r.ok) await advance({ ...o }, true);
    else {
      const f = await one<any>(`UPDATE ${S}.standing_orders SET fail_count = fail_count + 1, next_run_at = now() + interval '1 day' WHERE id = $1 RETURNING fail_count`, [o.id]);
      await tellBoth(o, ['A scheduled payment failed', `${r.error ?? ''} — we try again tomorrow.`], ['ما زبطت دفعة مجدولة', `${r.error ?? ''} — رح نجرّب بكرة.`]);
      if ((f?.fail_count ?? 0) >= 3) await advance(o, false);
    }
  }
}

const orderCols = `o.*, u.full_name AS to_name, u.username AS to_username, ta.iban AS to_iban, fa.iban AS from_iban, fa.nickname AS from_nickname`;
const orderFrom = `FROM ${S}.standing_orders o JOIN ${S}.users u ON u.id = o.to_user_id JOIN ${S}.bank_accounts ta ON ta.id = o.to_account_id JOIN ${S}.bank_accounts fa ON fa.id = o.from_account_id`;

// ------------------------------------------------------------------ routes
export const scheduledRouter = Router();
scheduledRouter.use(['/scheduled', '/blocks'], requireAuth);

scheduledRouter.get(
  '/scheduled',
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const orders = await pool.query(`SELECT ${orderCols} ${orderFrom} WHERE o.user_id = $1 ORDER BY (o.active AND NOT o.paused_by_admin) DESC, o.awaiting DESC, o.next_run_at`, [me]);
    const incoming = await pool.query(
      `SELECT o.id, o.title, o.category, o.amount, o.every, o.every_days, o.next_run_at, o.consent, o.active, o.created_at, o.ends, o.max_runs, o.runs, w.full_name AS owner_name, w.id AS owner_id
         FROM ${S}.standing_orders o JOIN ${S}.users w ON w.id = o.user_id WHERE o.to_user_id = $1 AND o.active ORDER BY (o.consent = 'pending') DESC, o.created_at DESC`,
      [me],
    );
    const off = await pool.query(`SELECT u.id, u.full_name, x.created_at FROM ${S}.payee_optouts x JOIN ${S}.users u ON u.id = x.owner_id WHERE x.user_id = $1`, [me]);
    const t = await one<any>(
      `SELECT COALESCE(sum(CASE every WHEN 'week' THEN amount * 4.33 WHEN '2weeks' THEN amount * 2.17 WHEN 'days' THEN amount * 30.0 / GREATEST(every_days, 1) WHEN 'once' THEN 0 ELSE amount END), 0)::numeric(20,2)::text AS monthly,
              (SELECT COALESCE(sum(r.amount), 0)::text FROM ${S}.standing_order_runs r WHERE r.user_id = $1 AND r.status = 'done' AND r.ran_at > now() - interval '30 days') AS last30
         FROM ${S}.standing_orders WHERE user_id = $1 AND active AND NOT paused_by_admin AND consent = 'accepted'`,
      [me],
    );
    res.json({ success: true, data: { orders: orders.rows.map((o) => ({ ...o, to_name: maskName(o.to_name) })), incoming: incoming.rows.map((o) => ({ ...o, owner_name: o.owner_name })), optouts: off.rows, totals: t } });
  }),
);

const body = z
  .object({
    fromAccountId: uuid,
    to: z.string().trim().min(3).max(64),
    title: z.string().trim().max(60).optional(),
    category: z.string().trim().max(40).optional(),
    amount: amountSchema,
    every: z.enum(EVERY),
    everyDays: z.number().int().min(1).max(365).optional(),
    startAt: z.string().datetime().optional(),
    ends: z.enum(['never', 'until', 'count']).default('never'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    maxRuns: z.number().int().min(1).max(1000).optional(),
    auto: z.boolean().default(true),
    remindBefore: z.number().int().min(0).max(30).nullable().optional(),
    totp: totpCode.optional(),
  })
  .strict()
  .refine((b) => b.every !== 'days' || b.everyDays, 'How many days between payments?')
  .refine((b) => b.ends !== 'until' || b.endDate, 'Choose the last date')
  .refine((b) => b.ends !== 'count' || b.maxRuns, 'How many payments?');

scheduledRouter.post(
  '/scheduled',
  moneyLimiter,
  validate({ body }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const b = req.body as z.infer<typeof body>;
    assertMaxTransfer(b.amount);
    await ownAccount(me, b.fromAccountId);
    await requireSecondFactor(me, b.totp);
    const r = await resolveRecipient(b.to);
    if (String(r.user_id) === String(me)) throw badRequest('SELF', 'Use a transfer between your own accounts');
    await assertNotBlocked(me, String(r.user_id));
    if (await one(`SELECT 1 FROM ${S}.payee_optouts WHERE user_id = $1 AND owner_id = $2`, [r.user_id, me])) throw forbidden('This person asked not to receive scheduled payments from you', 'OPTED_OUT');
    const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.standing_orders WHERE user_id = $1 AND active`, [me]);
    if ((n?.n ?? 0) >= 100) throw badRequest('TOO_MANY_PAYOUTS', 'Up to 100 recurring transfers');
    // Someone who already accepted a payment from you doesn't need to accept again.
    const known = await one(`SELECT 1 FROM ${S}.standing_orders WHERE user_id = $1 AND to_user_id = $2 AND consent = 'accepted' LIMIT 1`, [me, r.user_id]);
    const o = await one<any>(
      `INSERT INTO ${S}.standing_orders (user_id, from_account_id, to_account_id, to_user_id, title, category, amount, every, every_days, next_run_at, ends, end_date, max_runs, auto, remind_before, consent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
      [me, b.fromAccountId, r.id, r.user_id, b.title || null, b.category || null, b.amount, b.every, b.every === 'days' ? b.everyDays : null, b.startAt ? new Date(b.startAt) : new Date(), b.ends, b.ends === 'until' ? b.endDate : null, b.ends === 'count' ? b.maxRuns : null, b.auto, b.remindBefore ?? null, known ? 'accepted' : 'pending'],
    );
    if (!known) {
      const w = await one<any>(`SELECT full_name FROM ${S}.users WHERE id = $1`, [me]);
      await notify(undefined, r.user_id, 'scheduled_invite', `${w?.full_name ?? ''} wants to send you scheduled payments`, `${b.amount} ${env.CURRENCY}${b.title ? ` — ${b.title}` : ''}. Accept or decline.`, {
        ar: { title: `${w?.full_name ?? ''} بدّه يبعتلك دفعات مجدولة`, body: `${b.amount} ${env.CURRENCY}${b.title ? ` — ${b.title}` : ''}. وافق أو ارفض.` },
        link: '/app/scheduled?tab=incoming',
        orderId: o.id,
      });
    }
    await audit({ userId: me, action: 'scheduled.created', entityType: 'standing_order', entityId: o.id, details: { amount: b.amount, every: b.every } }, req);
    if (known && b.auto) await runScheduled([o.id]);
    res.status(201).json({ success: true, data: { id: o.id, consent: o.consent } });
  }),
);

async function ownOrder(id: string, me: string) {
  const o = await one<any>(`SELECT * FROM ${S}.standing_orders WHERE id = $1 AND user_id = $2`, [id, me]);
  if (!o) throw notFound('Transfer not found');
  return o;
}

scheduledRouter.put(
  '/scheduled/:id',
  validate({
    params: z.object({ id: uuid }).strict(),
    body: z
      .object({
        title: z.string().trim().max(60).nullable().optional(),
        category: z.string().trim().max(40).nullable().optional(),
        amount: amountSchema.optional(),
        every: z.enum(EVERY).optional(),
        everyDays: z.number().int().min(1).max(365).optional(),
        nextAt: z.string().datetime().optional(),
        ends: z.enum(['never', 'until', 'count']).optional(),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        maxRuns: z.number().int().min(1).max(1000).nullable().optional(),
        auto: z.boolean().optional(),
        remindBefore: z.number().int().min(0).max(30).nullable().optional(),
        active: z.boolean().optional(),
        totp: totpCode.optional(),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const o = await ownOrder(req.params.id!, me);
    const b = req.body;
    if (o.paused_by_admin && b.active) throw badRequest('PAUSED_BY_ADMIN', 'The team paused this payment');
    if ((b.amount && Number(b.amount) > Number(o.amount)) || (b.active && !o.active)) await requireSecondFactor(me, b.totp);
    if (b.amount) assertMaxTransfer(b.amount);
    const has = (k: string) => k in b;
    await pool.query(
      `UPDATE ${S}.standing_orders SET
         title = CASE WHEN $2 THEN $3 ELSE title END, category = CASE WHEN $4 THEN $5 ELSE category END,
         amount = COALESCE($6, amount), every = COALESCE($7, every), every_days = CASE WHEN $8 THEN $9 ELSE every_days END,
         next_run_at = COALESCE($10, next_run_at), ends = COALESCE($11, ends), end_date = CASE WHEN $12 THEN $13::date ELSE end_date END,
         max_runs = CASE WHEN $14 THEN $15 ELSE max_runs END, auto = COALESCE($16, auto), remind_before = CASE WHEN $17 THEN $18 ELSE remind_before END,
         active = COALESCE($19, active), finished_at = CASE WHEN $19 THEN NULL ELSE finished_at END, reminded_for = NULL
       WHERE id = $1`,
      [o.id, has('title'), b.title ?? null, has('category'), b.category ?? null, b.amount ?? null, b.every ?? null, has('everyDays'), b.everyDays ?? null, b.nextAt ?? null, b.ends ?? null, has('endDate'), b.endDate ?? null, has('maxRuns'), b.maxRuns ?? null, b.auto ?? null, has('remindBefore'), b.remindBefore ?? null, b.active ?? null],
    );
    if (b.active && new Date(o.next_run_at) < new Date()) await pool.query(`UPDATE ${S}.standing_orders SET next_run_at = now() + interval '1 hour', awaiting = false WHERE id = $1`, [o.id]);
    res.json({ success: true });
  }),
);

scheduledRouter.delete(
  '/scheduled/:id',
  validate({ params: z.object({ id: uuid }).strict() }),
  ah(async (req, res) => {
    const o = await ownOrder(req.params.id!, req.auth!.userId);
    await pool.query(`UPDATE ${S}.standing_orders SET active = false, finished_at = now() WHERE id = $1`, [o.id]);
    res.json({ success: true });
  }),
);

scheduledRouter.post(
  '/scheduled/:id/pay-now',
  moneyLimiter,
  validate({ params: z.object({ id: uuid }).strict(), body: z.object({ totp: totpCode.optional() }).strict() }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    await requireSecondFactor(me, req.body.totp);
    const o = await ownOrder(req.params.id!, me);
    if (o.paused_by_admin) throw badRequest('PAUSED_BY_ADMIN', 'The team paused this payment');
    if (o.consent !== 'accepted') throw badRequest('NOT_ACCEPTED', 'Waiting for them to accept');
    const r = await deliver(o);
    if (!r.ok) throw badRequest(r.code ?? 'TRANSFER_FAILED', r.error ?? 'The transfer failed');
    await advance(o, true);
    res.json({ success: true });
  }),
);

scheduledRouter.post(
  '/scheduled/:id/skip',
  validate({ params: z.object({ id: uuid }).strict() }),
  ah(async (req, res) => {
    const o = await ownOrder(req.params.id!, req.auth!.userId);
    await pool.query(`INSERT INTO ${S}.standing_order_runs (order_id, user_id, amount, status) VALUES ($1, $2, $3, 'skipped')`, [o.id, o.user_id, o.amount]);
    await advance(o, false);
    res.json({ success: true });
  }),
);

scheduledRouter.get(
  '/scheduled/:id/runs',
  validate({ params: z.object({ id: uuid }).strict() }),
  ah(async (req, res) => {
    await ownOrder(req.params.id!, req.auth!.userId);
    const r = await pool.query(`SELECT id, amount, status, error, ran_at FROM ${S}.standing_order_runs WHERE order_id = $1 ORDER BY ran_at DESC LIMIT 100`, [req.params.id]);
    res.json({ success: true, data: { runs: r.rows } });
  }),
);

/** The receiver: accept, or decline (and maybe stop the sender asking again). */
scheduledRouter.post(
  '/scheduled/incoming/:id',
  validate({ params: z.object({ id: uuid }).strict(), body: z.object({ action: z.enum(['accept', 'decline']), stop: z.boolean().default(false) }).strict() }),
  ah(async (req, res) => {
    const me = String(req.auth!.userId);
    const o = await one<any>(`SELECT o.*, u.full_name AS to_name FROM ${S}.standing_orders o JOIN ${S}.users u ON u.id = o.to_user_id WHERE o.id = $1 AND o.to_user_id = $2 AND o.active`, [req.params.id, me]);
    if (!o) throw notFound('Not found');
    if (req.body.action === 'accept') {
      // Accepting one payment from someone accepts all of theirs to you.
      await pool.query(`UPDATE ${S}.standing_orders SET consent = 'accepted' WHERE user_id = $1 AND to_user_id = $2 AND active`, [o.user_id, me]);
      await tellBoth(o, [`${o.to_name} accepted`, 'Their scheduled payments can go out now.'], [`${o.to_name} وافق`, 'صار فيك تبعتله الدفعات المجدولة.']);
      const due = await pool.query(`SELECT id FROM ${S}.standing_orders WHERE user_id = $1 AND to_user_id = $2 AND active AND auto AND next_run_at <= now() + interval '1 minute'`, [o.user_id, me]);
      if (due.rowCount) await runScheduled(due.rows.map((x) => x.id));
    } else {
      await tx(async (c) => {
        await c.query(`UPDATE ${S}.standing_orders SET active = false, finished_at = now() WHERE user_id = $1 AND to_user_id = $2 AND active`, [o.user_id, me]);
        if (req.body.stop) await c.query(`INSERT INTO ${S}.payee_optouts (user_id, owner_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [me, o.user_id]);
      });
      await tellBoth(o, [`${o.to_name} declined your scheduled payments`, 'They were stopped.'], [`${o.to_name} رفض الدفعات المجدولة`, 'وقفناها.']);
    }
    await audit({ userId: me, action: `scheduled.incoming_${req.body.action}`, entityType: 'standing_order', entityId: o.id }, req);
    res.json({ success: true });
  }),
);

scheduledRouter.delete(
  '/scheduled/optouts/:ownerId',
  validate({ params: z.object({ ownerId: uuid }).strict() }),
  ah(async (req, res) => {
    await pool.query(`DELETE FROM ${S}.payee_optouts WHERE user_id = $1 AND owner_id = $2`, [req.auth!.userId, req.params.ownerId]);
    res.json({ success: true });
  }),
);

// ------------------------------------------------------------------ blocks
scheduledRouter.get(
  '/blocks',
  ah(async (req, res) => {
    const r = await pool.query(
      `SELECT u.id, u.full_name, u.username, b.created_at, b.by_admin IS NOT NULL AS by_team FROM ${S}.user_blocks b JOIN ${S}.users u ON u.id = b.blocked_id WHERE b.blocker_id = $1 ORDER BY b.created_at DESC`,
      [req.auth!.userId],
    );
    res.json({ success: true, data: { blocks: r.rows } });
  }),
);

scheduledRouter.post(
  '/blocks',
  validate({ body: z.object({ to: z.string().trim().min(3).max(64).optional(), userId: uuid.optional() }).strict().refine((b) => b.to || b.userId, 'Who should be blocked?') }),
  ah(async (req, res) => {
    const me = String(req.auth!.userId);
    const r = req.body.userId
      ? await one<any>(`SELECT id AS user_id, full_name FROM ${S}.users WHERE id = $1 AND role = 'user'`, [req.body.userId])
      : await resolveRecipient(req.body.to);
    if (!r) throw notFound('User not found');
    if (String(r.user_id) === me) throw badRequest('SELF', 'That’s you');
    await tx(async (c) => {
      await c.query(`INSERT INTO ${S}.user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [me, r.user_id]);
      await c.query(`UPDATE ${S}.standing_orders SET active = false, finished_at = now() WHERE active AND ((user_id = $1 AND to_user_id = $2) OR (user_id = $2 AND to_user_id = $1))`, [me, r.user_id]);
    });
    await audit({ userId: me, action: 'user.blocked', entityType: 'user', entityId: String(r.user_id) }, req);
    res.status(201).json({ success: true, data: { holder: maskName(r.full_name) } });
  }),
);

scheduledRouter.delete(
  '/blocks/:userId',
  validate({ params: z.object({ userId: uuid }).strict() }),
  ah(async (req, res) => {
    const b = await one<any>(`SELECT id, by_admin FROM ${S}.user_blocks WHERE blocker_id = $1 AND blocked_id = $2`, [req.auth!.userId, req.params.userId]);
    if (!b) throw notFound('Not found');
    if (b.by_admin) throw forbidden('The team put this block — ask support to lift it', 'BLOCK_BY_TEAM');
    await pool.query(`DELETE FROM ${S}.user_blocks WHERE id = $1`, [b.id]);
    res.json({ success: true });
  }),
);

// ------------------------------------------------------------------ admins
export const scheduledAdminRouter = Router();

scheduledAdminRouter.get(
  '/scheduled',
  requirePerm('customers.view'),
  validate({ query: z.object({ q: z.string().trim().max(80).optional() }).strict() }),
  ah(async (req, res) => {
    const q = (req.query as any).q;
    const r = await pool.query(
      `SELECT o.id, o.title, o.category, o.amount, o.every, o.every_days, o.next_run_at, o.consent, o.active, o.paused_by_admin, o.admin_note, o.runs, o.total, o.fail_count, o.created_at,
              w.full_name AS owner_name, w.email AS owner_email, u.full_name AS to_name, u.email AS to_email
         FROM ${S}.standing_orders o JOIN ${S}.users w ON w.id = o.user_id JOIN ${S}.users u ON u.id = o.to_user_id
        WHERE ($1::text IS NULL OR w.full_name ILIKE $1 OR u.full_name ILIKE $1 OR w.email ILIKE $1 OR u.email ILIKE $1)
        ORDER BY o.active DESC, o.created_at DESC LIMIT 300`,
      [q ? `%${q}%` : null],
    );
    const t = await one<any>(
      `SELECT count(*) FILTER (WHERE active)::int AS active, count(*) FILTER (WHERE active AND consent = 'pending')::int AS pending,
              (SELECT COALESCE(sum(amount), 0)::text FROM ${S}.standing_order_runs WHERE status = 'done' AND ran_at > now() - interval '30 days') AS last30
         FROM ${S}.standing_orders`,
    );
    res.json({ success: true, data: { orders: r.rows, totals: t } });
  }),
);

scheduledAdminRouter.post(
  '/scheduled/:id/pause',
  requirePerm('accounts.freeze'),
  validate({ params: z.object({ id: uuid }).strict(), body: z.object({ paused: z.boolean(), note: z.string().trim().max(300).optional() }).strict() }),
  ah(async (req, res) => {
    const o = await one<any>(`UPDATE ${S}.standing_orders SET paused_by_admin = $2, admin_note = $3 WHERE id = $1 RETURNING *`, [req.params.id, req.body.paused, req.body.note ?? null]);
    if (!o) throw notFound('Transfer not found');
    await tellBoth(o, req.body.paused ? ['The bank paused a scheduled payment', req.body.note ?? ''] : ['Your scheduled payment runs again', ''], req.body.paused ? ['البنك أوقف دفعة مجدولة', req.body.note ?? 'تواصل مع الدعم.'] : ['رجعت الدفعة المجدولة تشتغل', '']);
    await audit({ userId: req.auth!.userId, action: req.body.paused ? 'admin.scheduled_paused' : 'admin.scheduled_resumed', entityType: 'standing_order', entityId: req.params.id! }, req);
    res.json({ success: true });
  }),
);

scheduledAdminRouter.get(
  '/blocks',
  requirePerm('customers.status'),
  validate({ query: z.object({ q: z.string().trim().max(80).optional() }).strict() }),
  ah(async (req, res) => {
    const q = (req.query as any).q;
    const r = await pool.query(
      `SELECT b.id, b.created_at, b.note, b.by_admin IS NOT NULL AS by_team, ad.full_name AS admin_name,
              json_build_object('id', a.id, 'full_name', a.full_name, 'email', a.email) AS blocker, json_build_object('id', x.id, 'full_name', x.full_name, 'email', x.email) AS blocked
         FROM ${S}.user_blocks b JOIN ${S}.users a ON a.id = b.blocker_id JOIN ${S}.users x ON x.id = b.blocked_id LEFT JOIN ${S}.users ad ON ad.id = b.by_admin
        WHERE ($1::text IS NULL OR a.full_name ILIKE $1 OR x.full_name ILIKE $1 OR a.email ILIKE $1 OR x.email ILIKE $1)
        ORDER BY b.created_at DESC LIMIT 300`,
      [q ? `%${q}%` : null],
    );
    res.json({ success: true, data: { blocks: r.rows } });
  }),
);

scheduledAdminRouter.post(
  '/blocks',
  requirePerm('customers.status'),
  validate({ body: z.object({ blockerId: uuid, blockedId: uuid, note: z.string().trim().max(300).optional() }).strict() }),
  ah(async (req, res) => {
    const { blockerId, blockedId, note } = req.body;
    if (blockerId === blockedId) throw badRequest('SELF', 'Pick two different people');
    const n = await one<any>(`SELECT count(*)::int AS n FROM ${S}.users WHERE id = ANY($1)`, [[blockerId, blockedId]]);
    if (n?.n !== 2) throw notFound('User not found');
    await pool.query(
      `INSERT INTO ${S}.user_blocks (blocker_id, blocked_id, by_admin, note) VALUES ($1, $2, $3, $4) ON CONFLICT (blocker_id, blocked_id) DO UPDATE SET by_admin = EXCLUDED.by_admin, note = EXCLUDED.note`,
      [blockerId, blockedId, req.auth!.userId, note ?? null],
    );
    await pool.query(`UPDATE ${S}.standing_orders SET active = false, finished_at = now() WHERE active AND ((user_id = $1 AND to_user_id = $2) OR (user_id = $2 AND to_user_id = $1))`, [blockerId, blockedId]);
    await audit({ userId: req.auth!.userId, action: 'admin.block_added', entityType: 'user', entityId: blockedId, details: { blockerId, note } }, req);
    res.status(201).json({ success: true });
  }),
);

scheduledAdminRouter.delete(
  '/blocks/:id',
  requirePerm('customers.status'),
  validate({ params: z.object({ id: uuid }).strict() }),
  ah(async (req, res) => {
    const b = await one<any>(`DELETE FROM ${S}.user_blocks WHERE id = $1 RETURNING blocked_id`, [req.params.id]);
    if (!b) throw notFound('Not found');
    await audit({ userId: req.auth!.userId, action: 'admin.block_removed', entityType: 'user', entityId: String(b.blocked_id) }, req);
    res.json({ success: true });
  }),
);

export function startScheduledRunner() {
  const t = setInterval(() => {
    runScheduled().catch((err) => logger.warn({ err }, 'scheduled payments failed'));
  }, 2 * 60_000);
  t.unref();
}

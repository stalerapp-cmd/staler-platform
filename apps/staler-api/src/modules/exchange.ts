import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { one, pool, S, tx } from '../lib/db.js';
import { hmac, randomToken, safeEqual } from '../lib/crypto.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { amountSchema } from '../lib/money.js';
import { uuid, validate } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { moneyLimiter } from '../middleware/security.js';
import { assertDailyLimit, assertMaxTransfer, credit, debit, maskName, notify, notifyBi, walletOfUser, walletToWallet, writeLine } from './walletCore.js';

/**
 * Cash agents ("exchange" role) hand out money through one-time vouchers.
 * The voucher amount is taken from the agent's wallet when the voucher is
 * created (escrow), so it can never be claimed twice or exceed what the agent
 * has. The QR carries a 192-bit secret; only its HMAC is stored.
 */
export const exchangeRouter = Router();
exchangeRouter.use(requireAuth);

const VOUCHER_TTL_MIN = 10;
export const voucherUri = (id: string, secret: string) => `taler://exchange-claim?v=${id}.${secret}`;

exchangeRouter.post(
  '/vouchers',
  requireRole('exchange'),
  moneyLimiter,
  validate({ body: z.object({ amount: amountSchema, description: z.string().trim().max(140).optional().default('') }).strict() }),
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    const { amount, description } = req.body;
    assertMaxTransfer(amount);
    const secret = randomToken(24);
    const v = await tx(async (c) => {
      const w = await walletOfUser(userId, c, true);
      const balance = await debit(c, w.id, amount);
      const row = await one<any>(
        `INSERT INTO ${S}.exchange_vouchers (exchange_user_id, amount, description, secret_hash, status, expires_at)
         VALUES ($1, $2, $3, $4, 'active', now() + interval '${VOUCHER_TTL_MIN} minutes') RETURNING id, amount, description, status, expires_at, created_at`,
        [userId, amount, description, hmac(`voucher|${secret}`)],
        c,
      );
      await writeLine(c, {
        userId,
        walletId: w.wallet_id,
        type: 'voucher_issued',
        amount: `-${amount}`,
        description: description || 'Cash-out voucher',
        reference: row.id,
        balanceAfter: balance,
      });
      return row;
    });
    await audit({ userId, action: 'exchange.voucher_created', entityType: 'voucher', entityId: v.id, details: { amount } }, req);
    res.status(201).json({ success: true, data: { voucher: { ...v, uri: voucherUri(v.id, secret) } } });
  }),
);

exchangeRouter.get(
  '/vouchers',
  requireRole('exchange'),
  ah(async (req, res) => {
    const r = await pool.query(
      `SELECT v.id, v.amount, v.description, v.created_at, v.expires_at, v.claimed_at,
              CASE WHEN v.status = 'active' AND v.expires_at < now() THEN 'expired' ELSE v.status END AS status, u.full_name AS claimed_by_name
         FROM ${S}.exchange_vouchers v LEFT JOIN ${S}.users u ON u.id = v.claimed_by
        WHERE v.exchange_user_id = $1 ORDER BY v.created_at DESC LIMIT 50`,
      [req.auth!.userId],
    );
    res.json({ success: true, data: { vouchers: r.rows.map((x) => ({ ...x, claimed_by_name: x.claimed_by_name ? maskName(x.claimed_by_name) : null })) } });
  }),
);

/** Returns escrowed money for an unclaimed voucher (cancelled or expired). */
export async function refundVoucher(voucherId: string, newStatus: 'cancelled') {
  return tx(async (c) => {
    const v = await one<any>(
      `UPDATE ${S}.exchange_vouchers SET status = $2 WHERE id = $1 AND status = 'active' RETURNING *`,
      [voucherId, newStatus],
      c,
    );
    if (!v) return null;
    const w = await walletOfUser(v.exchange_user_id, c, true);
    const balance = await credit(c, w.id, v.amount);
    await writeLine(c, {
      userId: v.exchange_user_id,
      walletId: w.wallet_id,
      type: 'voucher_refund',
      amount: v.amount,
      description: 'Voucher returned',
      reference: v.id,
      balanceAfter: balance,
    });
    return v;
  });
}

exchangeRouter.delete(
  '/vouchers/:id',
  requireRole('exchange'),
  validate({ params: z.object({ id: uuid }).strict() }),
  ah(async (req, res) => {
    const own = await one(`SELECT 1 FROM ${S}.exchange_vouchers WHERE id = $1 AND exchange_user_id = $2`, [req.params.id, req.auth!.userId]);
    if (!own) throw notFound('Voucher not found');
    const v = await refundVoucher(req.params.id!, 'cancelled');
    if (!v) throw conflict('VOUCHER_CLOSED', 'This voucher was already used or cancelled');
    res.json({ success: true });
  }),
);

const voucherParam = z
  .string()
  .trim()
  .max(300)
  .transform((s) => {
    const raw = s.startsWith('taler://') ? new URL(s.replace('taler://', 'https://x/')).searchParams.get('v') ?? '' : s;
    return raw;
  })
  .pipe(z.string().regex(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{32}$/, 'Invalid voucher'));

exchangeRouter.post(
  '/vouchers/preview',
  validate({ body: z.object({ voucher: voucherParam }).strict() }),
  ah(async (req, res) => {
    const [id] = req.body.voucher.split('.');
    const v = await one<any>(
      `SELECT v.amount, v.description, v.status, v.expires_at, u.full_name FROM ${S}.exchange_vouchers v JOIN ${S}.users u ON u.id = v.exchange_user_id WHERE v.id = $1`,
      [id],
    );
    if (!v) throw notFound('Voucher not found');
    res.json({
      success: true,
      data: { amount: v.amount, description: v.description, agent: maskName(v.full_name), status: v.status === 'active' && new Date(v.expires_at) < new Date() ? 'expired' : v.status },
    });
  }),
);

exchangeRouter.post(
  '/claim',
  moneyLimiter,
  validate({ body: z.object({ voucher: voucherParam }).strict() }),
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    const [id, secret] = req.body.voucher.split('.') as [string, string];
    const result = await tx(async (c) => {
      const v = await one<any>(`SELECT * FROM ${S}.exchange_vouchers WHERE id = $1 FOR UPDATE`, [id], c);
      if (!v || !safeEqual(v.secret_hash, hmac(`voucher|${secret}`))) throw notFound('Voucher not found');
      if (String(v.exchange_user_id) === String(userId)) throw forbidden('You cannot claim your own voucher', 'OWN_VOUCHER');
      if (v.status !== 'active') throw conflict('VOUCHER_USED', 'This voucher was already used');
      if (new Date(v.expires_at) < new Date()) throw conflict('VOUCHER_EXPIRED', 'This voucher has expired');
      await c.query(`UPDATE ${S}.exchange_vouchers SET status = 'claimed', claimed_by = $2, claimed_at = now() WHERE id = $1`, [v.id, userId]);
      const w = await walletOfUser(userId, c, true);
      const balance = await credit(c, w.id, v.amount);
      const agent = await one<any>(`SELECT full_name FROM ${S}.users WHERE id = $1`, [v.exchange_user_id], c);
      await writeLine(c, {
        userId,
        walletId: w.wallet_id,
        type: 'exchange_deposit',
        amount: v.amount,
        description: v.description || 'Cash voucher',
        counterparty: agent?.full_name ?? 'Exchange',
        reference: v.id,
        balanceAfter: balance,
      });
      await notify(c, v.exchange_user_id, 'voucher_claimed', 'Voucher claimed', `${v.amount} ${env.CURRENCY} voucher was redeemed`);
      return { amount: v.amount as string, balance };
    });
    await audit({ userId, action: 'exchange.voucher_claimed', entityType: 'voucher', entityId: id }, req);
    res.json({ success: true, data: result });
  }),
);

// ------------------------------------------------------------------ agents
const optText = (n: number) => z.string().trim().max(n).nullable().optional();

/** Active cash agents customers can visit (public profile only). */
exchangeRouter.get(
  '/agents',
  ah(async (_req, res) => {
    const r = await pool.query(
      `SELECT a.user_id AS id, a.display_name, a.city, a.address, a.lat, a.lng, a.hours, COALESCE(a.logo_url, u.profile_image) AS logo_url, a.cash_in, a.cash_out, a.phone
         FROM ${S}.agent_profiles a JOIN ${S}.users u ON u.id = a.user_id
        WHERE a.status = 'active' AND u.status = 'active' AND u.role = 'exchange'
        ORDER BY a.city NULLS LAST, a.display_name`,
    );
    res.json({ success: true, data: { agents: r.rows } });
  }),
);

async function profileOf(userId: string) {
  const p = await one<any>(`SELECT * FROM ${S}.agent_profiles WHERE user_id = $1`, [userId]);
  if (p) return p;
  const u = await one<any>(`SELECT full_name, phone_number FROM ${S}.users WHERE id = $1`, [userId]);
  return { user_id: userId, display_name: u?.full_name ?? '', phone: u?.phone_number ?? null, city: null, address: null, lat: null, lng: null, hours: null, logo_url: null, cash_in: true, cash_out: true, status: 'pending', missing: true };
}

exchangeRouter.get(
  '/profile',
  requireRole('exchange'),
  ah(async (req, res) => {
    res.json({ success: true, data: { profile: await profileOf(req.auth!.userId) } });
  }),
);

export const agentProfileBody = z
  .object({
    displayName: z.string().trim().min(2).max(60),
    city: optText(60),
    address: optText(160),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    phone: z.string().trim().regex(/^\+?[0-9 ]{7,20}$/, 'Invalid phone number').nullable().optional().or(z.literal('').transform(() => null)),
    hours: optText(120),
    logoUrl: optText(500),
    cashIn: z.boolean().optional(),
    cashOut: z.boolean().optional(),
  })
  .strict();

export async function saveAgentProfile(userId: string, b: z.infer<typeof agentProfileBody>, status?: string) {
  await pool.query(
    `INSERT INTO ${S}.agent_profiles (user_id, display_name, city, address, lat, lng, phone, hours, logo_url, cash_in, cash_out, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,true),COALESCE($11,true),COALESCE($12,'pending'))
     ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, city = EXCLUDED.city, address = EXCLUDED.address,
       lat = EXCLUDED.lat, lng = EXCLUDED.lng, phone = EXCLUDED.phone, hours = EXCLUDED.hours, logo_url = EXCLUDED.logo_url,
       cash_in = COALESCE($10, ${S}.agent_profiles.cash_in), cash_out = COALESCE($11, ${S}.agent_profiles.cash_out),
       status = COALESCE($12, ${S}.agent_profiles.status), updated_at = now()`,
    [userId, b.displayName, b.city ?? null, b.address ?? null, b.lat ?? null, b.lng ?? null, b.phone ?? null, b.hours ?? null, b.logoUrl ?? null, b.cashIn ?? null, b.cashOut ?? null, status ?? null],
  );
}

exchangeRouter.put(
  '/profile',
  requireRole('exchange'),
  validate({ body: agentProfileBody }),
  ah(async (req, res) => {
    await saveAgentProfile(req.auth!.userId, req.body);
    await audit({ userId: req.auth!.userId, action: 'exchange.profile_updated', entityType: 'user', entityId: req.auth!.userId }, req);
    res.json({ success: true, data: { profile: await profileOf(req.auth!.userId) } });
  }),
);

/** The agent desk: today's cash in/out at a glance. */
exchangeRouter.get(
  '/stats',
  requireRole('exchange'),
  ah(async (req, res) => {
    const id = req.auth!.userId;
    const v = await one<any>(
      `SELECT count(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS issued_today,
              COALESCE(SUM(amount) FILTER (WHERE status = 'claimed' AND claimed_at >= date_trunc('day', now())), 0)::text AS cash_in_today,
              COALESCE(SUM(amount) FILTER (WHERE status = 'active' AND expires_at > now()), 0)::text AS in_escrow,
              count(*) FILTER (WHERE status = 'claimed')::int AS claimed_total
         FROM ${S}.exchange_vouchers WHERE exchange_user_id = $1`,
      [id],
    );
    const o = await one<any>(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'paid' AND paid_at >= date_trunc('day', now())), 0)::text AS cash_out_today,
              count(*) FILTER (WHERE status = 'paid')::int AS paid_total
         FROM ${S}.agent_cashouts WHERE agent_id = $1`,
      [id],
    );
    const w = await walletOfUser(id);
    res.json({ success: true, data: { ...v, ...o, balance: w.balance } });
  }),
);

// --------------------------------------------------------------- cash-out
const CASHOUT_TTL_MIN = 15;
export const cashoutUri = (id: string, secret: string) => `taler://agent-cashout?c=${id}.${secret}`;
const cashoutParam = z
  .string()
  .trim()
  .max(300)
  .transform((s) => (s.startsWith('taler://') ? new URL(s.replace('taler://', 'https://x/')).searchParams.get('c') ?? '' : s))
  .pipe(z.string().regex(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{32}$/, 'Invalid code'));

exchangeRouter.post(
  '/cashouts',
  requireRole('exchange'),
  moneyLimiter,
  validate({ body: z.object({ amount: amountSchema }).strict() }),
  ah(async (req, res) => {
    assertMaxTransfer(req.body.amount);
    const secret = randomToken(24);
    const row = await one<any>(
      `INSERT INTO ${S}.agent_cashouts (agent_id, amount, secret_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '${CASHOUT_TTL_MIN} minutes') RETURNING id, amount, status, expires_at, created_at`,
      [req.auth!.userId, req.body.amount, hmac(`cashout|${secret}`)],
    );
    await audit({ userId: req.auth!.userId, action: 'exchange.cashout_created', entityType: 'cashout', entityId: row.id, details: { amount: row.amount } }, req);
    res.status(201).json({ success: true, data: { cashout: { ...row, uri: cashoutUri(row.id, secret) } } });
  }),
);

exchangeRouter.get(
  '/cashouts',
  requireRole('exchange'),
  ah(async (req, res) => {
    const r = await pool.query(
      `SELECT c.id, c.amount, c.created_at, c.expires_at, c.paid_at,
              CASE WHEN c.status = 'open' AND c.expires_at < now() THEN 'expired' ELSE c.status END AS status, u.full_name AS paid_by_name
         FROM ${S}.agent_cashouts c LEFT JOIN ${S}.users u ON u.id = c.paid_by
        WHERE c.agent_id = $1 ORDER BY c.created_at DESC LIMIT 50`,
      [req.auth!.userId],
    );
    res.json({ success: true, data: { cashouts: r.rows.map((x) => ({ ...x, paid_by_name: x.paid_by_name ? maskName(x.paid_by_name) : null })) } });
  }),
);

exchangeRouter.delete(
  '/cashouts/:id',
  requireRole('exchange'),
  validate({ params: z.object({ id: uuid }).strict() }),
  ah(async (req, res) => {
    const r = await pool.query(`UPDATE ${S}.agent_cashouts SET status = 'cancelled' WHERE id = $1 AND agent_id = $2 AND status = 'open'`, [req.params.id, req.auth!.userId]);
    if (!r.rowCount) throw conflict('CASHOUT_CLOSED', 'This request was already paid or cancelled');
    res.json({ success: true });
  }),
);

exchangeRouter.post(
  '/cashouts/preview',
  validate({ body: z.object({ code: cashoutParam }).strict() }),
  ah(async (req, res) => {
    const [id] = req.body.code.split('.');
    const c = await one<any>(
      `SELECT c.amount, c.status, c.expires_at, COALESCE(a.display_name, u.full_name) AS agent
         FROM ${S}.agent_cashouts c JOIN ${S}.users u ON u.id = c.agent_id LEFT JOIN ${S}.agent_profiles a ON a.user_id = c.agent_id WHERE c.id = $1`,
      [id],
    );
    if (!c) throw notFound('Request not found');
    res.json({ success: true, data: { amount: c.amount, agent: c.agent, status: c.status === 'open' && new Date(c.expires_at) < new Date() ? 'expired' : c.status } });
  }),
);

/** Customer pays the agent's cash-out request from the wallet; the agent then hands over cash. */
exchangeRouter.post(
  '/cashouts/pay',
  requireRole('user', 'merchant', 'exchange'),
  moneyLimiter,
  validate({ body: z.object({ code: cashoutParam }).strict() }),
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    const [id, secret] = req.body.code.split('.') as [string, string];
    const out = await tx(async (c) => {
      const co = await one<any>(`SELECT * FROM ${S}.agent_cashouts WHERE id = $1 FOR UPDATE`, [id], c);
      if (!co || !safeEqual(co.secret_hash, hmac(`cashout|${secret}`))) throw notFound('Request not found');
      if (String(co.agent_id) === String(userId)) throw forbidden('You cannot pay your own request', 'OWN_CASHOUT');
      if (co.status !== 'open') throw conflict('CASHOUT_CLOSED', 'This request was already paid or cancelled');
      if (new Date(co.expires_at) < new Date()) throw conflict('CASHOUT_EXPIRED', 'This request has expired');
      const me = await walletOfUser(userId, c);
      const agentW = await walletOfUser(co.agent_id, c);
      await assertDailyLimit(c, me.wallet_id, co.amount);
      const names = await c.query(`SELECT id, full_name FROM ${S}.users WHERE id = ANY($1::uuid[])`, [[userId, co.agent_id]]);
      const nameOf = (x: string) => names.rows.find((r) => String(r.id) === String(x))?.full_name ?? null;
      const m = await walletToWallet(c, {
        fromWalletDbId: me.id,
        toWalletDbId: agentW.id,
        amount: co.amount,
        outType: 'cash_out',
        inType: 'cash_out_received',
        description: 'Cash withdrawal at agent',
        fromName: nameOf(userId),
        toName: nameOf(co.agent_id),
        metadata: { cashout: co.id },
      });
      await c.query(`UPDATE ${S}.agent_cashouts SET status = 'paid', paid_by = $2, paid_at = now() WHERE id = $1`, [co.id, userId]);
      await notifyBi(
        c,
        co.agent_id,
        'cashout_paid',
        ['Cash-out paid', `${co.amount} ${env.CURRENCY} arrived — hand over the cash.`],
        ['تم دفع طلب السحب', `وصل ${co.amount} ${env.CURRENCY} — سلّم المبلغ نقدًا.`],
        { link: '/app/agent' },
      );
      return { amount: co.amount as string, balance: m.fromBalance };
    });
    await audit({ userId, action: 'exchange.cashout_paid', entityType: 'cashout', entityId: id }, req);
    res.json({ success: true, data: out });
  }),
);

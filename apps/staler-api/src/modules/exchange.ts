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
import { assertMaxTransfer, credit, debit, maskName, notify, walletOfUser, writeLine } from './walletCore.js';

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
  requireRole('user', 'merchant', 'exchange'),
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
  requireRole('user', 'merchant', 'exchange'),
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
  requireRole('user', 'merchant', 'exchange'),
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

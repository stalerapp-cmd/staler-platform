import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { one, pool, S, tx } from '../lib/db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { amountSchema } from '../lib/money.js';
import { idempotencyKey, pageQuery, totpCode, validate } from '../lib/validate.js';
import { idempotent } from '../lib/idempotency.js';
import { audit } from '../lib/audit.js';
import { requireAuth } from '../middleware/auth.js';
import { moneyLimiter } from '../middleware/security.js';
import { requireSecondFactor } from './mfa.js';
import { assertDailyLimit, assertMaxTransfer, maskName, notify, walletOfUser, walletToWallet } from './walletCore.js';

export const walletRouter = Router();
walletRouter.use(requireAuth);

const recipientSchema = z.string().trim().min(3).max(254);

/** Recipient by public wallet id (QR) or e-mail address. */
export async function resolveRecipient(raw: string) {
  const q = raw.trim();
  let row: any;
  if (/^[a-z_]*[a-z0-9_]{6,40}$/i.test(q) && !q.includes('@')) {
    row = await one(
      `SELECT w.id, w.wallet_id, w.user_id, w.is_frozen, u.full_name, u.status, u.role FROM ${S}.wallets w JOIN ${S}.users u ON u.id = w.user_id WHERE w.wallet_id = $1`,
      [q],
    );
  } else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)) {
    row = await one(
      `SELECT w.id, w.wallet_id, w.user_id, w.is_frozen, u.full_name, u.status, u.role
         FROM ${S}.users u JOIN LATERAL (SELECT * FROM ${S}.wallets WHERE user_id = u.id ORDER BY created_at ASC NULLS LAST LIMIT 1) w ON true
        WHERE lower(u.email) = $1`,
      [q.toLowerCase()],
    );
  } else {
    throw badRequest('INVALID_RECIPIENT', 'Enter a wallet ID or an e-mail address');
  }
  if (!row || row.status !== 'active') throw notFound('Recipient not found', 'RECIPIENT_NOT_FOUND');
  return row as { id: string; wallet_id: string; user_id: string; is_frozen: boolean; full_name: string; role: string };
}

walletRouter.get(
  '/',
  ah(async (req, res) => {
    const w = await walletOfUser(req.auth!.userId);
    const stats = await one(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE amount > 0 AND created_at > now() - interval '30 days'), 0)::text AS income_30d,
              COALESCE(-SUM(amount) FILTER (WHERE amount < 0 AND created_at > now() - interval '30 days'), 0)::text AS spending_30d,
              count(*)::int AS tx_count
         FROM ${S}.transactions WHERE wallet_id = $1 AND status IN ('completed','pending')`,
      [w.wallet_id],
    );
    const series = await pool.query(
      `WITH days AS (SELECT generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') AS d)
       SELECT to_char(d, 'YYYY-MM-DD') AS day,
              COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::text AS income,
              COALESCE(-SUM(t.amount) FILTER (WHERE t.amount < 0), 0)::text AS spending
         FROM days LEFT JOIN ${S}.transactions t ON date_trunc('day', t.created_at) = days.d AND t.wallet_id = $1 AND t.status = 'completed'
        GROUP BY d ORDER BY d`,
      [w.wallet_id],
    );
    res.json({
      success: true,
      data: { wallet: { walletId: w.wallet_id, balance: w.balance, currency: w.currency, frozen: w.is_frozen }, stats, series: series.rows },
    });
  }),
);

walletRouter.get(
  '/transactions',
  validate({
    query: pageQuery
      .extend({
        direction: z.enum(['in', 'out', 'all']).default('all'),
        type: z.string().regex(/^[a-z_]{2,30}$/).optional(),
        q: z.string().trim().max(64).optional(),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const w = await walletOfUser(req.auth!.userId);
    const f = req.query as any;
    const params: unknown[] = [w.wallet_id];
    const where = ['t.wallet_id = $1'];
    if (f.direction === 'in') where.push('t.amount > 0');
    if (f.direction === 'out') where.push('t.amount < 0');
    if (f.type) {
      params.push(f.type);
      where.push(`t.transaction_type = $${params.length}`);
    }
    if (f.q) {
      params.push(`%${f.q.replace(/[\\%_]/g, (m: string) => '\\' + m)}%`);
      where.push(`(t.description ILIKE $${params.length} OR t.counterparty_name ILIKE $${params.length} OR t.from_account ILIKE $${params.length} OR t.to_account ILIKE $${params.length})`);
    }
    params.push(f.limit, f.offset);
    const r = await pool.query(
      `SELECT t.id, t.transaction_type AS type, t.amount, t.currency, t.status, t.description, t.from_account, t.to_account,
              t.counterparty_name, t.balance_after, t.reference, t.created_at, COUNT(*) OVER() AS total
         FROM ${S}.transactions t WHERE ${where.join(' AND ')}
        ORDER BY t.created_at DESC, t.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({ success: true, data: { transactions: r.rows.map(({ total, ...t }) => t), total: Number(r.rows[0]?.total ?? 0) } });
  }),
);

walletRouter.get(
  '/lookup',
  moneyLimiter,
  validate({ query: z.object({ to: recipientSchema }).strict() }),
  ah(async (req, res) => {
    const r = await resolveRecipient(String(req.query.to));
    res.json({ success: true, data: { walletId: r.wallet_id, name: maskName(r.full_name), role: r.role } });
  }),
);

walletRouter.post(
  '/transfer',
  moneyLimiter,
  validate({
    body: z
      .object({
        to: recipientSchema,
        amount: amountSchema,
        description: z.string().trim().max(140).optional().default(''),
        totp: totpCode.optional(),
        kind: z.enum(['transfer', 'payment']).default('transfer'),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    const key = req.headers['idempotency-key'] ? idempotencyKey.parse(req.headers['idempotency-key']) : undefined;
    const out = await idempotent(`transfer:${userId}`, key, req.body, async () => {
      const { to, amount, description, totp, kind } = req.body;
      assertMaxTransfer(amount);
      await requireSecondFactor(userId, totp);
      const recipient = await resolveRecipient(to);
      const me = await one<any>(`SELECT full_name FROM ${S}.users WHERE id = $1`, [userId]);
      const result = await tx(async (c) => {
        const mine = await walletOfUser(userId, c);
        await assertDailyLimit(c, mine.wallet_id, amount);
        const moved = await walletToWallet(c, {
          fromWalletDbId: mine.id,
          toWalletDbId: recipient.id,
          amount,
          outType: kind === 'payment' ? 'payment' : 'transfer_out',
          inType: kind === 'payment' ? 'payment_received' : 'transfer_in',
          description: description || (kind === 'payment' ? 'QR payment' : 'Wallet transfer'),
          fromName: me.full_name,
          toName: recipient.full_name,
        });
        await notify(c, recipient.user_id, 'money_received', 'Money received', `${maskName(me.full_name)} sent you ${amount} ${env.CURRENCY}`, {
          reference: moved.reference,
        });
        return { ...moved, from: mine.wallet_id };
      });
      await audit({ userId, action: 'wallet.transfer', entityType: 'transfer', entityId: result.reference, details: { amount, to: recipient.wallet_id } }, req);
      return {
        status: 201,
        body: {
          success: true,
          data: {
            reference: result.reference,
            amount,
            to: { walletId: recipient.wallet_id, name: maskName(recipient.full_name) },
            balance: result.fromBalance,
          },
        },
      };
    });
    res.status(out.status).json(out.body);
  }),
);

walletRouter.get(
  '/reserves',
  ah(async (req, res) => {
    const w = await walletOfUser(req.auth!.userId);
    const r = await pool.query(
      `SELECT id, reserve_pub, amount, status, source, created_at FROM ${S}.reserves WHERE wallet_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [w.id],
    );
    res.json({ success: true, data: { reserves: r.rows } });
  }),
);

// ------------------------------------------------------------ notifications
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get(
  '/',
  ah(async (req, res) => {
    const r = await pool.query(
      `SELECT id, type, title, body, is_read, metadata, created_at FROM ${S}.notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.auth!.userId],
    );
    const unread = await one<{ n: string }>(`SELECT count(*)::text AS n FROM ${S}.notifications WHERE user_id = $1 AND is_read = false`, [req.auth!.userId]);
    res.json({ success: true, data: { notifications: r.rows, unread: Number(unread?.n ?? 0) } });
  }),
);

notificationsRouter.post(
  '/read-all',
  ah(async (req, res) => {
    await pool.query(`UPDATE ${S}.notifications SET is_read = true WHERE user_id = $1 AND is_read = false`, [req.auth!.userId]);
    res.json({ success: true });
  }),
);

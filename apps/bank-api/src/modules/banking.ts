import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { env } from '../config/env.js';
import { one, pool, S, tx } from '../lib/db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { amountSchema } from '../lib/money.js';
import { isValidIban, normalizeIban } from '../lib/iban.js';
import { idempotencyKey, pageQuery, totpCode, uuid, validate } from '../lib/validate.js';
import { idempotent } from '../lib/idempotency.js';
import { audit } from '../lib/audit.js';
import { requireAuth } from '../middleware/auth.js';
import { moneyLimiter } from '../middleware/security.js';
import { assertDailyLimit, assertMaxTransfer, move, notify } from './ledger.js';
import { requireSecondFactor } from './mfa.js';

export const bankingRouter = Router();
bankingRouter.use(requireAuth);

export async function ownAccount(userId: string, accountId: string, c?: pg.PoolClient) {
  const acc = await one<any>(
    `SELECT id, user_id, account_number, iban, currency, balance, debit_threshold, is_locked, is_taler_exchange, nickname, payto_uri, created_at
       FROM ${S}.bank_accounts WHERE id = $1 AND user_id = $2`,
    [accountId, userId],
    c,
  );
  // 404 (not 403) so the existence of other people's accounts is not revealed.
  if (!acc) throw notFound('Account not found', 'ACCOUNT_NOT_FOUND');
  return acc;
}

export const maskName = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((p, i) => (i === 0 ? p : `${p[0]}.`))
    .join(' ');

/** Resolves a recipient by IBAN, account number or username. */
async function resolveRecipient(raw: string) {
  const q = raw.trim();
  let row: any = null;
  if (/^[A-Za-z]{2}\d{2}[A-Za-z0-9 ]{10,40}$/.test(q)) {
    const iban = normalizeIban(q);
    row = await one(
      `SELECT a.id, a.iban, a.account_number, a.is_locked, a.is_taler_exchange, u.full_name, u.status
         FROM ${S}.bank_accounts a JOIN ${S}.users u ON u.id = a.user_id WHERE a.iban = $1`,
      [iban],
    );
    // Unknown IBAN: tell the user if they simply mistyped it (check digits fail).
    if (!row && !isValidIban(iban)) throw badRequest('INVALID_IBAN', 'This IBAN is not valid (check digits)');
  } else if (/^TB\d{10}$/i.test(q)) {
    row = await one(
      `SELECT a.id, a.iban, a.account_number, a.is_locked, a.is_taler_exchange, u.full_name, u.status
         FROM ${S}.bank_accounts a JOIN ${S}.users u ON u.id = a.user_id WHERE a.account_number = $1`,
      [q.toUpperCase()],
    );
  } else if (/^@?[a-z0-9_]{3,32}$/i.test(q)) {
    row = await one(
      `SELECT a.id, a.iban, a.account_number, a.is_locked, a.is_taler_exchange, u.full_name, u.status
         FROM ${S}.users u JOIN ${S}.bank_accounts a ON a.user_id = u.id
        WHERE u.username = $1 AND u.role = 'user' ORDER BY a.is_primary DESC, a.created_at ASC LIMIT 1`,
      [q.replace(/^@/, '').toLowerCase()],
    );
  } else {
    throw badRequest('INVALID_RECIPIENT', 'Enter an IBAN, account number or @username');
  }
  if (!row || row.status !== 'active' || row.is_taler_exchange) throw notFound('Recipient not found', 'RECIPIENT_NOT_FOUND');
  return row;
}

// ------------------------------------------------------------------ config
bankingRouter.get(
  '/accounts',
  ah(async (req, res) => {
    const r = await pool.query(
      `SELECT id, account_number, iban, currency, balance, debit_threshold, is_locked, nickname, created_at
         FROM ${S}.bank_accounts WHERE user_id = $1 ORDER BY is_primary DESC, created_at ASC`,
      [req.auth!.userId],
    );
    res.json({ success: true, data: { accounts: r.rows } });
  }),
);

bankingRouter.get(
  '/accounts/lookup',
  moneyLimiter,
  validate({ query: z.object({ q: z.string().trim().min(3).max(64) }).strict() }),
  ah(async (req, res) => {
    const r = await resolveRecipient(String(req.query.q));
    res.json({ success: true, data: { iban: r.iban, accountNumber: r.account_number, holder: maskName(r.full_name) } });
  }),
);

bankingRouter.get(
  '/accounts/:id',
  validate({ params: z.object({ id: uuid }).strict() }),
  ah(async (req, res) => {
    const acc = await ownAccount(req.auth!.userId, req.params.id!);
    const stats = await one(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE to_account_id = $1 AND created_at > now() - interval '30 days'), 0)::text AS income_30d,
         COALESCE(SUM(amount) FILTER (WHERE from_account_id = $1 AND created_at > now() - interval '30 days'), 0)::text AS spending_30d,
         COUNT(*)::text AS tx_count
       FROM ${S}.transactions WHERE (from_account_id = $1 OR to_account_id = $1) AND status = 'completed'`,
      [acc.id],
    );
    const series = await pool.query(
      `WITH days AS (SELECT generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') AS d)
       SELECT to_char(d, 'YYYY-MM-DD') AS day,
              COALESCE(SUM(t.amount) FILTER (WHERE t.to_account_id = $1), 0)::text AS income,
              COALESCE(SUM(t.amount) FILTER (WHERE t.from_account_id = $1), 0)::text AS spending
         FROM days LEFT JOIN ${S}.transactions t
           ON date_trunc('day', t.created_at) = days.d AND (t.from_account_id = $1 OR t.to_account_id = $1) AND t.status = 'completed'
        GROUP BY d ORDER BY d`,
      [acc.id],
    );
    res.json({ success: true, data: { account: acc, stats, series: series.rows } });
  }),
);

bankingRouter.patch(
  '/accounts/:id',
  validate({ params: z.object({ id: uuid }).strict(), body: z.object({ nickname: z.string().trim().min(1).max(40) }).strict() }),
  ah(async (req, res) => {
    const acc = await ownAccount(req.auth!.userId, req.params.id!);
    await pool.query(`UPDATE ${S}.bank_accounts SET nickname = $2 WHERE id = $1`, [acc.id, req.body.nickname]);
    res.json({ success: true });
  }),
);

const txFilters = pageQuery
  .extend({
    direction: z.enum(['in', 'out', 'all']).default('all'),
    type: z.enum(['transfer', 'deposit', 'withdrawal', 'taler_withdraw', 'taler_deposit', 'wire', 'fee']).optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    q: z.string().trim().max(64).optional(),
  })
  .strict();

function txQuery(accountId: string, f: z.infer<typeof txFilters>, forCsv = false) {
  const params: unknown[] = [accountId];
  const where: string[] = ['(t.from_account_id = $1 OR t.to_account_id = $1)'];
  if (f.direction === 'in') where.push('t.to_account_id = $1');
  if (f.direction === 'out') where.push('t.from_account_id = $1');
  if (f.type) {
    params.push(f.type);
    where.push(`t.type = $${params.length}`);
  }
  if (f.from) {
    params.push(f.from);
    where.push(`t.created_at >= $${params.length}::date`);
  }
  if (f.to) {
    params.push(f.to);
    where.push(`t.created_at < ($${params.length}::date + 1)`);
  }
  if (f.q) {
    params.push(`%${f.q.replace(/[\\%_]/g, (m) => '\\' + m)}%`);
    where.push(`(t.subject ILIKE $${params.length} OR fu.full_name ILIKE $${params.length} OR tu.full_name ILIKE $${params.length})`);
  }
  params.push(forCsv ? 10_000 : f.limit, forCsv ? 0 : f.offset);
  const sql = `
    SELECT t.id, t.reference, t.amount, t.currency, t.type, t.status, t.subject, t.created_at,
           CASE WHEN t.to_account_id = $1 THEN 'in' ELSE 'out' END AS direction,
           CASE WHEN t.to_account_id = $1 THEN t.to_balance_after ELSE t.from_balance_after END AS balance_after,
           CASE WHEN t.to_account_id = $1 THEN fu.full_name ELSE tu.full_name END AS counterparty,
           CASE WHEN t.to_account_id = $1 THEN fa.iban ELSE ta.iban END AS counterparty_iban,
           COUNT(*) OVER() AS total
      FROM ${S}.transactions t
      LEFT JOIN ${S}.bank_accounts fa ON fa.id = t.from_account_id
      LEFT JOIN ${S}.users fu ON fu.id = fa.user_id
      LEFT JOIN ${S}.bank_accounts ta ON ta.id = t.to_account_id
      LEFT JOIN ${S}.users tu ON tu.id = ta.user_id
     WHERE ${where.join(' AND ')}
     ORDER BY t.created_at DESC, t.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`;
  return { sql, params };
}

bankingRouter.get(
  '/accounts/:id/transactions',
  validate({ params: z.object({ id: uuid }).strict(), query: txFilters }),
  ah(async (req, res) => {
    const acc = await ownAccount(req.auth!.userId, req.params.id!);
    const { sql, params } = txQuery(acc.id, req.query as any);
    const r = await pool.query(sql, params);
    res.json({
      success: true,
      data: { transactions: r.rows.map(({ total, ...t }) => t), total: Number(r.rows[0]?.total ?? 0) },
    });
  }),
);

/** CSV cells are neutralised against formula injection (=, +, -, @ at the start). */
const csvCell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

bankingRouter.get(
  '/accounts/:id/statement.csv',
  validate({ params: z.object({ id: uuid }).strict(), query: txFilters }),
  ah(async (req, res) => {
    const acc = await ownAccount(req.auth!.userId, req.params.id!);
    const { sql, params } = txQuery(acc.id, req.query as any, true);
    const r = await pool.query(sql, params);
    const header = ['Date', 'Reference', 'Type', 'Direction', 'Counterparty', 'Counterparty IBAN', 'Subject', 'Amount', 'Currency', 'Balance after'];
    const lines = r.rows.map((t) =>
      [
        new Date(t.created_at).toISOString(),
        t.reference,
        t.type,
        t.direction,
        t.counterparty,
        t.counterparty_iban,
        t.subject,
        (t.direction === 'out' ? '-' : '') + t.amount,
        t.currency,
        t.balance_after,
      ]
        .map(csvCell)
        .join(','),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="statement-${acc.account_number}.csv"`);
    res.send('﻿' + [header.map(csvCell).join(','), ...lines].join('\r\n'));
  }),
);

// --------------------------------------------------------------- transfers
const transferBody = z
  .object({
    fromAccountId: uuid,
    to: z.string().trim().min(3).max(64),
    amount: amountSchema,
    subject: z.string().trim().max(140).optional().default(''),
    totp: totpCode.optional(),
  })
  .strict();

bankingRouter.post(
  '/transfers',
  moneyLimiter,
  validate({ body: transferBody }),
  ah(async (req, res) => {
    const key = req.headers['idempotency-key'] ? idempotencyKey.parse(req.headers['idempotency-key']) : undefined;
    const userId = req.auth!.userId;
    const result = await idempotent(`transfer:${userId}`, key, req.body, async () => {
      const { fromAccountId, to, amount, subject, totp } = req.body;
      assertMaxTransfer(amount);
      await ownAccount(userId, fromAccountId);
      await requireSecondFactor(userId, totp);
      const recipient = await resolveRecipient(to);
      const txRow = await tx(async (c) => {
        await ownAccount(userId, fromAccountId, c);
        await assertDailyLimit(c, userId, amount);
        const t = await move(c, {
          fromAccountId,
          toAccountId: recipient.id,
          amount,
          type: 'transfer',
          subject: subject || null,
          initiatedBy: userId,
        });
        const receiver = await one<{ user_id: string }>(`SELECT user_id FROM ${S}.bank_accounts WHERE id = $1`, [recipient.id], c);
        if (receiver && receiver.user_id !== userId) {
          await notify(c, receiver.user_id, 'transfer_in', 'Money received', `You received ${amount} ${env.CURRENCY}`, { transactionId: t.id });
        }
        return t;
      });
      await audit({ userId, action: 'transfer.created', entityType: 'transaction', entityId: txRow.id, details: { amount } }, req);
      return {
        status: 201,
        body: { success: true, data: { transaction: { ...txRow, recipient: { holder: maskName(recipient.full_name), iban: recipient.iban } } } },
      };
    });
    res.status(result.status).json(result.body);
  }),
);

// ------------------------------------------------- payment requests (QR)
bankingRouter.post(
  '/payment-requests',
  validate({
    body: z
      .object({ accountId: uuid, amount: amountSchema.optional(), description: z.string().trim().max(140).optional().default('') })
      .strict(),
  }),
  ah(async (req, res) => {
    const acc = await ownAccount(req.auth!.userId, req.body.accountId);
    if (acc.is_locked) throw forbidden('Account is frozen', 'ACCOUNT_LOCKED');
    const row = await one<any>(
      `INSERT INTO ${S}.qr_sessions (created_by, account_id, amount, currency, description, qr_data, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', 'pending', now() + interval '15 minutes')
       RETURNING id, amount, currency, description, status, expires_at, created_at`,
      [req.auth!.userId, acc.id, req.body.amount ?? null, env.CURRENCY, req.body.description],
    );
    const qr = `talerbank://pay/${row.id}`;
    await pool.query(`UPDATE ${S}.qr_sessions SET qr_data = $2 WHERE id = $1`, [row.id, qr]);
    res.status(201).json({ success: true, data: { request: { ...row, qr_data: qr } } });
  }),
);

bankingRouter.get(
  '/payment-requests',
  ah(async (req, res) => {
    const r = await pool.query(
      `SELECT q.id, q.amount, q.currency, q.description, q.qr_data,
              CASE WHEN q.status = 'pending' AND q.expires_at < now() THEN 'expired' ELSE q.status END AS status,
              q.expires_at, q.paid_at, q.created_at
         FROM ${S}.qr_sessions q WHERE q.created_by = $1 ORDER BY q.created_at DESC LIMIT 50`,
      [req.auth!.userId],
    );
    res.json({ success: true, data: { requests: r.rows } });
  }),
);

bankingRouter.get(
  '/payment-requests/:id',
  validate({ params: z.object({ id: uuid }).strict() }),
  ah(async (req, res) => {
    const q = await one<any>(
      `SELECT q.id, q.amount, q.currency, q.description, q.status, q.expires_at, a.iban, u.full_name
         FROM ${S}.qr_sessions q JOIN ${S}.bank_accounts a ON a.id = q.account_id JOIN ${S}.users u ON u.id = q.created_by
        WHERE q.id = $1`,
      [req.params.id],
    );
    if (!q) throw notFound('Payment request not found');
    const status = q.status === 'pending' && new Date(q.expires_at) < new Date() ? 'expired' : q.status;
    res.json({
      success: true,
      data: { request: { id: q.id, amount: q.amount, currency: q.currency, description: q.description, status, expires_at: q.expires_at, payee: maskName(q.full_name), iban: q.iban } },
    });
  }),
);

bankingRouter.post(
  '/payment-requests/:id/pay',
  moneyLimiter,
  validate({
    params: z.object({ id: uuid }).strict(),
    body: z.object({ fromAccountId: uuid, amount: amountSchema.optional(), totp: totpCode.optional() }).strict(),
  }),
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    await requireSecondFactor(userId, req.body.totp);
    const result = await tx(async (c) => {
      const q = await one<any>(`SELECT * FROM ${S}.qr_sessions WHERE id = $1 FOR UPDATE`, [req.params.id], c);
      if (!q) throw notFound('Payment request not found');
      if (q.status !== 'pending' || new Date(q.expires_at) < new Date()) throw conflict('REQUEST_CLOSED', 'This payment request is no longer payable');
      if (q.created_by === userId) throw badRequest('OWN_REQUEST', 'You cannot pay your own request');
      const amount: string | undefined = q.amount ?? req.body.amount;
      if (!amount) throw badRequest('AMOUNT_REQUIRED', 'Enter an amount');
      assertMaxTransfer(amount);
      await ownAccount(userId, req.body.fromAccountId, c);
      await assertDailyLimit(c, userId, amount);
      const t = await move(c, {
        fromAccountId: req.body.fromAccountId,
        toAccountId: q.account_id,
        amount,
        type: 'transfer',
        subject: q.description || 'QR payment',
        initiatedBy: userId,
        metadata: { paymentRequest: q.id },
      });
      await c.query(`UPDATE ${S}.qr_sessions SET status = 'paid', paid_by = $2, paid_at = now(), transaction_id = $3 WHERE id = $1`, [
        q.id,
        userId,
        t.id,
      ]);
      await notify(c, q.created_by, 'request_paid', 'Payment received', `Your request was paid: ${amount} ${env.CURRENCY}`, { transactionId: t.id });
      return t;
    });
    await audit({ userId, action: 'payment_request.paid', entityType: 'qr_session', entityId: req.params.id }, req);
    res.json({ success: true, data: { transaction: result } });
  }),
);

// ----------------------------------------------------------- notifications
bankingRouter.get(
  '/notifications',
  ah(async (req, res) => {
    const r = await pool.query(
      `SELECT id, type, title, body, is_read, metadata, created_at FROM ${S}.notifications
        WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.auth!.userId],
    );
    const unread = await one<{ n: string }>(`SELECT count(*)::text AS n FROM ${S}.notifications WHERE user_id = $1 AND is_read = false`, [req.auth!.userId]);
    res.json({ success: true, data: { notifications: r.rows, unread: Number(unread?.n ?? 0) } });
  }),
);

bankingRouter.post(
  '/notifications/read-all',
  ah(async (req, res) => {
    await pool.query(`UPDATE ${S}.notifications SET is_read = true WHERE user_id = $1 AND is_read = false`, [req.auth!.userId]);
    res.json({ success: true });
  }),
);

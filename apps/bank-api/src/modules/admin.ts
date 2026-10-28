import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { one, pool, S, tx } from '../lib/db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { amountSchema } from '../lib/money.js';
import { pageQuery, totpCode, uuid, validate } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { centralAccount, exchangeAccount, move, notify } from './ledger.js';
import { requireSecondFactor } from './mfa.js';
import { revokeAllSessions } from './sessions.js';
import { forgetUser } from '../lib/authCache.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));

const like = (q: string) => `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;

adminRouter.get(
  '/overview',
  ah(async (_req, res) => {
    const [users, money, activity, pending, series, recent] = await Promise.all([
      one(
        `SELECT count(*) FILTER (WHERE role = 'user')::int AS customers,
                count(*) FILTER (WHERE role = 'user' AND status = 'active')::int AS active,
                count(*) FILTER (WHERE role = 'user' AND status = 'suspended')::int AS suspended,
                count(*) FILTER (WHERE role = 'admin')::int AS admins,
                count(*) FILTER (WHERE totp_enabled)::int AS with_2fa
           FROM ${S}.users`,
      ),
      one(
        `SELECT COALESCE(SUM(a.balance) FILTER (WHERE u.role = 'user'), 0)::text AS customer_deposits,
                COALESCE(SUM(a.balance) FILTER (WHERE a.is_taler_exchange), 0)::text AS exchange_balance,
                COALESCE(SUM(a.balance) FILTER (WHERE u.role = 'admin' AND NOT a.is_taler_exchange), 0)::text AS central_balance,
                count(*) FILTER (WHERE a.is_locked)::int AS frozen_accounts,
                count(*)::int AS accounts
           FROM ${S}.bank_accounts a JOIN ${S}.users u ON u.id = a.user_id`,
      ),
      one(
        `SELECT count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS tx_24h,
                COALESCE(SUM(amount) FILTER (WHERE created_at > now() - interval '24 hours'), 0)::text AS volume_24h,
                COALESCE(SUM(amount) FILTER (WHERE created_at > now() - interval '7 days'), 0)::text AS volume_7d
           FROM ${S}.transactions WHERE status = 'completed'`,
      ),
      one(`SELECT count(*)::int AS n FROM ${S}.withdrawal_operations WHERE status IN ('pending','selected') AND expires_at > now()`),
      pool.query(
        `WITH days AS (SELECT generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') AS d)
         SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(SUM(t.amount), 0)::text AS volume, count(t.id)::int AS count
           FROM days LEFT JOIN ${S}.transactions t ON date_trunc('day', t.created_at) = days.d AND t.status = 'completed'
          GROUP BY d ORDER BY d`,
      ),
      pool.query(
        `SELECT l.action, l.created_at, l.ip_address, u.email FROM ${S}.audit_log l LEFT JOIN ${S}.users u ON u.id = l.user_id
          ORDER BY l.created_at DESC LIMIT 12`,
      ),
    ]);
    res.json({ success: true, data: { users, money, activity, pendingWithdrawals: pending?.n ?? 0, series: series.rows, recent: recent.rows } });
  }),
);

adminRouter.get(
  '/users',
  validate({
    query: pageQuery.extend({ q: z.string().trim().max(64).optional(), status: z.enum(['active', 'suspended', 'pending']).optional() }).strict(),
  }),
  ah(async (req, res) => {
    const q = req.query as any;
    const params: unknown[] = [];
    const where = [`u.role <> 'exchange'`];
    if (q.q) {
      params.push(like(q.q));
      where.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.username ILIKE $${params.length})`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`u.status = $${params.length}`);
    }
    params.push(q.limit, q.offset);
    const r = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.username, u.role, u.status, u.totp_enabled, u.created_at, u.last_login_at,
              COALESCE((SELECT SUM(balance) FROM ${S}.bank_accounts WHERE user_id = u.id), 0)::text AS total_balance,
              COUNT(*) OVER() AS total
         FROM ${S}.users u WHERE ${where.join(' AND ')}
        ORDER BY u.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({ success: true, data: { users: r.rows.map(({ total, ...u }) => u), total: Number(r.rows[0]?.total ?? 0) } });
  }),
);

adminRouter.get(
  '/users/:id',
  validate({ params: z.object({ id: uuid }).strict() }),
  ah(async (req, res) => {
    const user = await one(
      `SELECT id, full_name, email, username, role, status, phone, language, totp_enabled, email_verified, failed_login_count,
              locked_until, created_at, last_login_at FROM ${S}.users WHERE id = $1 AND role <> 'exchange'`,
      [req.params.id],
    );
    if (!user) throw notFound('User not found');
    const accounts = await pool.query(
      `SELECT id, account_number, iban, balance, currency, is_locked, debit_threshold, nickname, created_at FROM ${S}.bank_accounts WHERE user_id = $1`,
      [req.params.id],
    );
    const transactions = await pool.query(
      `SELECT t.id, t.amount, t.type, t.subject, t.created_at,
              CASE WHEN fa.user_id = $1 THEN 'out' ELSE 'in' END AS direction
         FROM ${S}.transactions t
         LEFT JOIN ${S}.bank_accounts fa ON fa.id = t.from_account_id
         LEFT JOIN ${S}.bank_accounts ta ON ta.id = t.to_account_id
        WHERE fa.user_id = $1 OR ta.user_id = $1 ORDER BY t.created_at DESC LIMIT 25`,
      [req.params.id],
    );
    const apps = await pool.query(
      `SELECT id, client_name, created_at, last_used_at, expires_at FROM ${S}.api_tokens WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [req.params.id],
    );
    res.json({ success: true, data: { user, accounts: accounts.rows, transactions: transactions.rows, linkedApps: apps.rows } });
  }),
);

adminRouter.patch(
  '/users/:id',
  validate({
    params: z.object({ id: uuid }).strict(),
    body: z.object({ status: z.enum(['active', 'suspended']).optional(), role: z.enum(['user', 'admin']).optional() }).strict(),
  }),
  ah(async (req, res) => {
    if (req.params.id === req.auth!.userId) throw forbidden('You cannot change your own status or role');
    const target = await one<any>(`SELECT id, role FROM ${S}.users WHERE id = $1`, [req.params.id]);
    if (!target || target.role === 'exchange') throw notFound('User not found');
    await pool.query(
      `UPDATE ${S}.users SET status = COALESCE($2, status), role = COALESCE($3, role),
              token_version = token_version + CASE WHEN $2 IS NOT NULL OR $3 IS NOT NULL THEN 1 ELSE 0 END WHERE id = $1`,
      [req.params.id, req.body.status ?? null, req.body.role ?? null],
    );
    forgetUser(req.params.id);
    if (req.body.status === 'suspended') await revokeAllSessions(req.params.id!);
    await audit({ userId: req.auth!.userId, action: 'admin.user_updated', entityType: 'user', entityId: req.params.id, details: req.body }, req);
    res.json({ success: true });
  }),
);

adminRouter.post(
  '/users/:id/revoke-sessions',
  validate({ params: z.object({ id: uuid }).strict() }),
  ah(async (req, res) => {
    await revokeAllSessions(req.params.id!);
    await audit({ userId: req.auth!.userId, action: 'admin.sessions_revoked', entityType: 'user', entityId: req.params.id }, req);
    res.json({ success: true });
  }),
);

adminRouter.post(
  '/users/:id/reset-2fa',
  validate({ params: z.object({ id: uuid }).strict(), body: z.object({ totp: totpCode.optional() }).strict() }),
  ah(async (req, res) => {
    await requireSecondFactor(req.auth!.userId, req.body.totp);
    await pool.query(
      `UPDATE ${S}.users SET totp_enabled = false, totp_secret_enc = NULL, totp_last_step = NULL, totp_recovery_hashes = '{}',
              token_version = token_version + 1 WHERE id = $1 AND role <> 'exchange'`,
      [req.params.id],
    );
    forgetUser(req.params.id);
    await audit({ userId: req.auth!.userId, action: 'admin.2fa_reset', entityType: 'user', entityId: req.params.id }, req);
    res.json({ success: true });
  }),
);

adminRouter.post(
  '/accounts/:id/freeze',
  validate({ params: z.object({ id: uuid }).strict(), body: z.object({ frozen: z.boolean() }).strict() }),
  ah(async (req, res) => {
    const r = await pool.query(
      `UPDATE ${S}.bank_accounts SET is_locked = $2 WHERE id = $1 AND is_taler_exchange = false RETURNING user_id`,
      [req.params.id, req.body.frozen],
    );
    if (r.rowCount === 0) throw notFound('Account not found');
    await notify(undefined, r.rows[0].user_id, 'account_status', req.body.frozen ? 'Account frozen' : 'Account unfrozen', req.body.frozen ? 'Contact support for details.' : 'Your account is active again.');
    await audit({ userId: req.auth!.userId, action: req.body.frozen ? 'admin.account_frozen' : 'admin.account_unfrozen', entityType: 'account', entityId: req.params.id }, req);
    res.json({ success: true });
  }),
);

/** Teller desk: physical cash in/out, booked against the bank's central account. */
adminRouter.post(
  '/teller',
  validate({
    body: z
      .object({
        accountId: uuid,
        amount: amountSchema,
        direction: z.enum(['in', 'out']),
        note: z.string().trim().min(3).max(140),
        totp: totpCode.optional(),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    await requireSecondFactor(req.auth!.userId, req.body.totp);
    const { accountId, amount, direction, note } = req.body;
    const t = await tx(async (c) => {
      const central = await centralAccount(c);
      const target = await one<any>(`SELECT id, user_id, is_taler_exchange FROM ${S}.bank_accounts WHERE id = $1`, [accountId], c);
      if (!target || target.is_taler_exchange) throw notFound('Account not found');
      if (target.id === central.id) throw badRequest('CENTRAL_ACCOUNT', 'Choose a customer account');
      const moved = await move(c, {
        fromAccountId: direction === 'in' ? central.id : target.id,
        toAccountId: direction === 'in' ? target.id : central.id,
        amount,
        type: direction === 'in' ? 'deposit' : 'withdrawal',
        subject: note,
        initiatedBy: req.auth!.userId,
        allowLockedSource: direction === 'in',
        metadata: { teller: req.auth!.userId },
      });
      await notify(c, target.user_id, direction === 'in' ? 'cash_in' : 'cash_out', direction === 'in' ? 'Cash deposit' : 'Cash withdrawal', `${amount} ${env.CURRENCY} — ${note}`);
      return moved;
    });
    await audit({ userId: req.auth!.userId, action: `admin.teller_${direction}`, entityType: 'transaction', entityId: t.id, details: { amount, accountId } }, req);
    res.status(201).json({ success: true, data: { transaction: t } });
  }),
);

adminRouter.get(
  '/transactions',
  validate({ query: pageQuery.extend({ q: z.string().trim().max(64).optional(), type: z.string().max(20).optional() }).strict() }),
  ah(async (req, res) => {
    const q = req.query as any;
    const params: unknown[] = [];
    const where = ['true'];
    if (q.q) {
      params.push(like(q.q));
      where.push(`(t.subject ILIKE $${params.length} OR fu.full_name ILIKE $${params.length} OR tu.full_name ILIKE $${params.length} OR t.reference ILIKE $${params.length})`);
    }
    if (q.type) {
      params.push(q.type);
      where.push(`t.type = $${params.length}`);
    }
    params.push(q.limit, q.offset);
    const r = await pool.query(
      `SELECT t.id, t.reference, t.amount, t.currency, t.type, t.status, t.subject, t.created_at,
              fu.full_name AS from_name, fa.iban AS from_iban, tu.full_name AS to_name, ta.iban AS to_iban, COUNT(*) OVER() AS total
         FROM ${S}.transactions t
         LEFT JOIN ${S}.bank_accounts fa ON fa.id = t.from_account_id LEFT JOIN ${S}.users fu ON fu.id = fa.user_id
         LEFT JOIN ${S}.bank_accounts ta ON ta.id = t.to_account_id LEFT JOIN ${S}.users tu ON tu.id = ta.user_id
        WHERE ${where.join(' AND ')} ORDER BY t.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({ success: true, data: { transactions: r.rows.map(({ total, ...t }) => t), total: Number(r.rows[0]?.total ?? 0) } });
  }),
);

adminRouter.get(
  '/audit',
  validate({ query: pageQuery.extend({ action: z.string().max(64).optional() }).strict() }),
  ah(async (req, res) => {
    const q = req.query as any;
    const params: unknown[] = [];
    let where = 'true';
    if (q.action) {
      params.push(like(q.action));
      where = `l.action ILIKE $1`;
    }
    params.push(q.limit, q.offset);
    const r = await pool.query(
      `SELECT l.id, l.action, l.entity_type, l.entity_id, l.details, l.ip_address, l.user_agent, l.created_at, u.email, COUNT(*) OVER() AS total
         FROM ${S}.audit_log l LEFT JOIN ${S}.users u ON u.id = l.user_id
        WHERE ${where} ORDER BY l.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({ success: true, data: { events: r.rows.map(({ total, ...e }) => e), total: Number(r.rows[0]?.total ?? 0) } });
  }),
);

adminRouter.get(
  '/exchange',
  ah(async (_req, res) => {
    const ex = await exchangeAccount();
    const reserves = await pool.query(
      `SELECT r.reserve_pub, r.amount, r.status, r.source, r.created_at, u.full_name
         FROM ${S}.reserves r LEFT JOIN ${S}.bank_accounts a ON a.id = r.account_id LEFT JOIN ${S}.users u ON u.id = a.user_id
        ORDER BY r.created_at DESC LIMIT 25`,
    );
    const wires = await pool.query(
      `SELECT id, amount, to_iban, to_name, subject, status, executed_at FROM ${S}.wire_transfers ORDER BY created_at DESC LIMIT 25`,
    );
    res.json({ success: true, data: { account: { iban: ex.iban, balance: ex.balance, payto: ex.payto_uri }, reserves: reserves.rows, wires: wires.rows } });
  }),
);

const SETTINGS_SCHEMA = z
  .object({
    allow_registrations: z.boolean().optional(),
    maintenance_mode: z.boolean().optional(),
    bank_name: z.string().trim().min(2).max(60).optional(),
  })
  .strict();

adminRouter.get(
  '/settings',
  ah(async (_req, res) => {
    const r = await pool.query(`SELECT key, value FROM ${S}.settings WHERE key = ANY($1)`, [['allow_registrations', 'maintenance_mode', 'bank_name']]);
    res.json({ success: true, data: { settings: Object.fromEntries(r.rows.map((x) => [x.key, x.value])) } });
  }),
);

adminRouter.put(
  '/settings',
  validate({ body: SETTINGS_SCHEMA }),
  ah(async (req, res) => {
    for (const [key, value] of Object.entries(req.body)) {
      await pool.query(
        `INSERT INTO ${S}.settings (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(value)],
      );
    }
    await audit({ userId: req.auth!.userId, action: 'admin.settings_updated', details: req.body }, req);
    res.json({ success: true });
  }),
);

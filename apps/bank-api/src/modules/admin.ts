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
import { PERMISSIONS, assertCanManage, isSuper, requirePerm } from '../lib/permissions.js';
import { codeHash, numericCode } from '../lib/crypto.js';
import { codeMail, noticeMail, sendMail, sendMailNow } from '../lib/mailer.js';
import { hashPassword, passwordSchema } from '../lib/passwords.js';
import { email, fullName, username } from '../lib/validate.js';
import { conflict } from '../lib/errors.js';

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
                COALESCE(SUM(a.balance) FILTER (WHERE u.admin_level = 'super_admin' AND NOT a.is_taler_exchange), 0)::text AS central_balance,
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
  requirePerm('customers.view'),
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
  requirePerm('customers.view'),
  validate({ params: z.object({ id: uuid }).strict() }),
  ah(async (req, res) => {
    const user = await one(
      `SELECT id, full_name, email, username, role, admin_level, admin_permissions, status, phone, language, totp_enabled, email_verified, failed_login_count,
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

/** Edit a customer: profile, e-mail, username and status. Each field needs its permission. */
adminRouter.patch(
  '/users/:id',
  validate({
    params: z.object({ id: uuid }).strict(),
    body: z
      .object({
        fullName: fullName.optional(),
        email: email.optional(),
        username: username.optional(),
        phone: z.string().trim().regex(/^\+?[0-9 ]{7,20}$/, 'Invalid phone number').nullable().optional(),
        language: z.enum(['en', 'ar']).optional(),
        status: z.enum(['active', 'suspended']).optional(),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const b = req.body;
    const target = await one<any>(`SELECT id, email, role, admin_level, language FROM ${S}.users WHERE id = $1 AND role <> 'exchange'`, [req.params.id]);
    if (!target) throw notFound('User not found');
    assertCanManage(req, target);
    const need: string[] = [];
    if (b.fullName !== undefined || b.email !== undefined || b.username !== undefined || b.phone !== undefined || b.language !== undefined) need.push('customers.edit');
    if (b.status !== undefined) need.push('customers.status');
    for (const p of need) if (!isSuper(req) && !(req.auth!.permissions ?? []).includes(p)) throw forbidden('You do not have permission for this action', 'NO_PERMISSION');
    if (b.email && b.email !== target.email.toLowerCase() && (await one(`SELECT 1 FROM ${S}.users WHERE lower(email) = $1 AND id <> $2`, [b.email, target.id]))) {
      throw conflict('EMAIL_TAKEN', 'This e-mail is already registered');
    }
    if (b.username && (await one(`SELECT 1 FROM ${S}.users WHERE username = $1 AND id <> $2`, [b.username, target.id]))) throw conflict('USERNAME_TAKEN', 'This username is taken');
    await pool.query(
      `UPDATE ${S}.users SET full_name = COALESCE($2, full_name), email = COALESCE($3, email), username = COALESCE($4, username),
              phone = CASE WHEN $5 THEN $6 ELSE phone END, language = COALESCE($7, language), status = COALESCE($8, status),
              email_verified = CASE WHEN $3::text IS NOT NULL THEN true ELSE email_verified END,
              token_version = token_version + CASE WHEN $8::text IS NOT NULL THEN 1 ELSE 0 END
        WHERE id = $1`,
      [target.id, b.fullName ?? null, b.email ?? null, b.username ?? null, b.phone !== undefined, b.phone ?? null, b.language ?? null, b.status ?? null],
    );
    forgetUser(target.id);
    if (b.status === 'suspended') await revokeAllSessions(target.id);
    if (b.email && b.email !== target.email.toLowerCase()) {
      await sendMail(noticeMail(target.email, 'E-mail changed', `The bank changed the e-mail on your account to ${b.email}.`, target.language ?? 'en'));
    }
    await audit({ userId: req.auth!.userId, action: 'admin.user_updated', entityType: 'user', entityId: target.id, details: b }, req);
    res.json({ success: true });
  }),
);

adminRouter.post(
  '/users/:id/password',
  requirePerm('customers.password'),
  validate({ params: z.object({ id: uuid }).strict(), body: z.object({ password: passwordSchema }).strict() }),
  ah(async (req, res) => {
    const t = await one<any>(`SELECT id, email, role, admin_level, language FROM ${S}.users WHERE id = $1 AND role <> 'exchange'`, [req.params.id]);
    if (!t) throw notFound('User not found');
    assertCanManage(req, t);
    await pool.query(`UPDATE ${S}.users SET password_hash = $2, password_changed_at = now(), failed_login_count = 0, locked_until = NULL WHERE id = $1`, [
      t.id,
      await hashPassword(req.body.password),
    ]);
    await revokeAllSessions(t.id);
    await sendMail(noticeMail(t.email, 'Password changed', 'The bank set a new password on your account. You were signed out everywhere.', t.language ?? 'en'));
    await audit({ userId: req.auth!.userId, action: 'admin.password_set', entityType: 'user', entityId: t.id }, req);
    res.json({ success: true });
  }),
);

adminRouter.post(
  '/users/:id/send-reset',
  requirePerm('customers.password'),
  validate({ params: z.object({ id: uuid }).strict() }),
  ah(async (req, res) => {
    const t = await one<any>(`SELECT id, email, role, admin_level, language FROM ${S}.users WHERE id = $1 AND status = 'active' AND role <> 'exchange'`, [req.params.id]);
    if (!t) throw notFound('User not found');
    assertCanManage(req, t);
    const mail = t.email.toLowerCase();
    const code = numericCode(6);
    await pool.query(`UPDATE ${S}.verification_codes SET used = true WHERE lower(email) = $1 AND type = 'reset_password' AND used = false`, [mail]);
    await pool.query(
      `INSERT INTO ${S}.verification_codes (email, code, type, expires_at, user_id) VALUES ($1, $2, 'reset_password', now() + interval '15 minutes', $3)`,
      [mail, codeHash('reset', mail, code), t.id],
    );
    await sendMail(codeMail(mail, 'reset', code, t.language ?? 'en'));
    await audit({ userId: req.auth!.userId, action: 'admin.reset_sent', entityType: 'user', entityId: t.id }, req);
    res.json({ success: true });
  }),
);

/** Close a customer: accounts must be empty; data is anonymised, the ledger stays intact. */
adminRouter.delete(
  '/users/:id',
  requirePerm('customers.delete'),
  validate({ params: z.object({ id: uuid }).strict() }),
  ah(async (req, res) => {
    const t = await one<any>(`SELECT id, role, admin_level FROM ${S}.users WHERE id = $1 AND role <> 'exchange'`, [req.params.id]);
    if (!t) throw notFound('User not found');
    assertCanManage(req, t);
    if (await one(`SELECT 1 FROM ${S}.bank_accounts WHERE user_id = $1 AND balance <> 0`, [t.id])) throw conflict('BALANCE_NOT_ZERO', 'The accounts still hold money');
    await pool.query(`UPDATE ${S}.bank_accounts SET is_locked = true WHERE user_id = $1`, [t.id]);
    await pool.query(`UPDATE ${S}.api_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [t.id]);
    await pool.query(
      `UPDATE ${S}.users SET status = 'suspended', email = 'deleted+' || id::text || '@deleted.invalid', full_name = 'Closed account', username = NULL,
              phone = NULL, password_hash = '!', totp_enabled = false, totp_secret_enc = NULL, totp_recovery_hashes = '{}' WHERE id = $1`,
      [t.id],
    );
    await revokeAllSessions(t.id);
    await audit({ userId: req.auth!.userId, action: 'admin.user_deleted', entityType: 'user', entityId: t.id }, req);
    res.json({ success: true });
  }),
);

const message = z.object({ title: z.string().trim().min(2).max(80), body: z.string().trim().min(2).max(500) }).strict();

adminRouter.post(
  '/users/:id/notify',
  requirePerm('notify'),
  validate({ params: z.object({ id: uuid }).strict(), body: message }),
  ah(async (req, res) => {
    const t = await one<any>(`SELECT id FROM ${S}.users WHERE id = $1`, [req.params.id]);
    if (!t) throw notFound('User not found');
    await notify(undefined, t.id, 'admin_message', req.body.title, req.body.body);
    await audit({ userId: req.auth!.userId, action: 'admin.user_notified', entityType: 'user', entityId: t.id }, req);
    res.json({ success: true });
  }),
);

adminRouter.post(
  '/broadcast',
  requirePerm('notify'),
  validate({ body: message }),
  ah(async (req, res) => {
    const r = await pool.query(
      `INSERT INTO ${S}.notifications (user_id, type, title, body, metadata)
       SELECT id, 'admin_message', $1, $2, '{}'::jsonb FROM ${S}.users WHERE status = 'active' AND role <> 'exchange'`,
      [req.body.title, req.body.body],
    );
    await audit({ userId: req.auth!.userId, action: 'admin.broadcast', details: { title: req.body.title, count: r.rowCount } }, req);
    res.json({ success: true, data: { sent: r.rowCount } });
  }),
);

// ---------------------------------------------------------- administrators
adminRouter.get('/permissions', (_req, res) => res.json({ success: true, data: { permissions: PERMISSIONS } }));

adminRouter.get(
  '/admins',
  requirePerm('admins.manage'),
  ah(async (_req, res) => {
    const r = await pool.query(
      `SELECT id, full_name, email, username, admin_level, admin_permissions, status, totp_enabled, last_login_at, created_at
         FROM ${S}.users WHERE role = 'admin' ORDER BY (admin_level = 'super_admin') DESC, created_at`,
    );
    res.json({ success: true, data: { admins: r.rows } });
  }),
);

const permList = z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length);

adminRouter.post(
  '/admins',
  requirePerm('admins.manage'),
  validate({
    body: z.object({ email, fullName: fullName.optional(), password: passwordSchema.optional(), permissions: permList, totp: totpCode.optional() }).strict(),
  }),
  ah(async (req, res) => {
    await requireSecondFactor(req.auth!.userId, req.body.totp);
    const b = req.body;
    const perms = [...new Set(b.permissions)];
    const existing = await one<any>(`SELECT id, role, admin_level FROM ${S}.users WHERE lower(email) = $1`, [b.email]);
    let id: string;
    if (existing) {
      if (existing.role === 'exchange') throw forbidden('System accounts cannot become administrators');
      if (existing.admin_level === 'super_admin') throw forbidden('The super admin account cannot be changed here', 'SUPER_ADMIN');
      await pool.query(`UPDATE ${S}.users SET role = 'admin', admin_level = 'admin', admin_permissions = $2, token_version = token_version + 1 WHERE id = $1`, [existing.id, perms]);
      id = existing.id;
    } else {
      if (!b.password || !b.fullName) throw conflict('NEW_ADMIN_DETAILS', 'Name and password are required for a new account');
      const u = await one<any>(
        `INSERT INTO ${S}.users (full_name, email, username, password_hash, role, admin_level, admin_permissions, status, email_verified, password_changed_at)
         VALUES ($1, $2, NULL, $3, 'admin', 'admin', $4, 'active', true, now()) RETURNING id`,
        [b.fullName, b.email, await hashPassword(b.password), perms],
      );
      id = u.id;
    }
    forgetUser(id);
    await audit({ userId: req.auth!.userId, action: 'admin.admin_granted', entityType: 'user', entityId: id, details: { permissions: perms } }, req);
    res.status(201).json({ success: true, data: { id } });
  }),
);

adminRouter.patch(
  '/admins/:id',
  requirePerm('admins.manage'),
  validate({ params: z.object({ id: uuid }).strict(), body: z.object({ permissions: permList }).strict() }),
  ah(async (req, res) => {
    const t = await one<any>(`SELECT id, role, admin_level FROM ${S}.users WHERE id = $1`, [req.params.id]);
    if (!t || t.role !== 'admin') throw notFound('Administrator not found');
    if (t.admin_level === 'super_admin') throw forbidden('The super admin always has every permission', 'SUPER_ADMIN');
    const perms = [...new Set(req.body.permissions)];
    await pool.query(`UPDATE ${S}.users SET admin_permissions = $2 WHERE id = $1`, [t.id, perms]);
    forgetUser(t.id);
    await audit({ userId: req.auth!.userId, action: 'admin.permissions_changed', entityType: 'user', entityId: t.id, details: { permissions: perms } }, req);
    res.json({ success: true });
  }),
);

adminRouter.delete(
  '/admins/:id',
  requirePerm('admins.manage'),
  validate({ params: z.object({ id: uuid }).strict() }),
  ah(async (req, res) => {
    const t = await one<any>(`SELECT id, role, admin_level FROM ${S}.users WHERE id = $1`, [req.params.id]);
    if (!t || t.role !== 'admin') throw notFound('Administrator not found');
    if (t.admin_level === 'super_admin') throw forbidden('The super admin cannot be removed', 'SUPER_ADMIN');
    await pool.query(`UPDATE ${S}.users SET role = 'user', admin_level = NULL, admin_permissions = '{}', token_version = token_version + 1 WHERE id = $1`, [t.id]);
    forgetUser(t.id);
    await revokeAllSessions(t.id);
    await audit({ userId: req.auth!.userId, action: 'admin.admin_revoked', entityType: 'user', entityId: t.id }, req);
    res.json({ success: true });
  }),
);

adminRouter.post(
  '/users/:id/revoke-sessions',
  requirePerm('customers.security'),
  validate({ params: z.object({ id: uuid }).strict() }),
  ah(async (req, res) => {
    const t = await one<any>(`SELECT id, role, admin_level FROM ${S}.users WHERE id = $1`, [req.params.id]);
    if (!t) throw notFound('User not found');
    assertCanManage(req, t);
    await revokeAllSessions(req.params.id!);
    await audit({ userId: req.auth!.userId, action: 'admin.sessions_revoked', entityType: 'user', entityId: req.params.id }, req);
    res.json({ success: true });
  }),
);

adminRouter.post(
  '/users/:id/reset-2fa',
  requirePerm('customers.security'),
  validate({ params: z.object({ id: uuid }).strict(), body: z.object({ totp: totpCode.optional() }).strict() }),
  ah(async (req, res) => {
    await requireSecondFactor(req.auth!.userId, req.body.totp);
    const t = await one<any>(`SELECT id, role, admin_level FROM ${S}.users WHERE id = $1`, [req.params.id]);
    if (!t) throw notFound('User not found');
    assertCanManage(req, t);
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
  requirePerm('accounts.freeze'),
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
  requirePerm('teller'),
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
  requirePerm('ledger.view'),
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
  requirePerm('audit.view'),
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
  requirePerm('exchange.view'),
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
  requirePerm('settings.manage'),
  ah(async (_req, res) => {
    const r = await pool.query(`SELECT key, value FROM ${S}.settings WHERE key = ANY($1)`, [['allow_registrations', 'maintenance_mode', 'bank_name']]);
    res.json({ success: true, data: { settings: Object.fromEntries(r.rows.map((x) => [x.key, x.value])) } });
  }),
);

adminRouter.put(
  '/settings',
  requirePerm('settings.manage'),
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

// ------------------------------------------------------------- mail check
/** Sends a test e-mail to the signed-in admin right now and reports exactly what happened. */
adminRouter.post(
  '/mail-test',
  requirePerm('settings.manage'),
  ah(async (req, res) => {
    const me = await one<{ email: string; language: string | null }>(`SELECT email, language FROM ${S}.users WHERE id = $1`, [req.auth!.userId]);
    const lang = me?.language === 'en' ? 'en' : 'ar';
    const r = await sendMailNow(codeMail(me!.email, 'verify', '123456', lang));
    res.json({ success: true, data: { to: me!.email, ...r } });
  }),
);

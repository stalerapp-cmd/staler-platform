import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { one, pool, S, tx } from '../lib/db.js';
import { codeHash, numericCode } from '../lib/crypto.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { hashPassword, passwordSchema } from '../lib/passwords.js';
import { codeMail, sendMail } from '../lib/mailer.js';
import { email, fullName, pageQuery, totpCode, validate } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { bank } from '../lib/bankClient.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { PERMISSIONS, assertCanManage, isSuper, requirePerm } from '../lib/permissions.js';
import { noticeMail } from '../lib/mailer.js';
import { notify } from './walletCore.js';
import { requireSecondFactor } from './mfa.js';
import { revokeAllSessions } from './sessions.js';
import { anonymiseUser } from './auth.js';
import { createWallet } from './walletCore.js';
import { addEvent, idParam, refundOrder, releaseEscrow } from './commerce.js';
import { reconcilePending } from './bank.js';
import { forgetUser } from '../lib/authCache.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));

const like = (q: string) => `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;

adminRouter.get(
  '/overview',
  ah(async (_req, res) => {
    const [users, money, activity, ops, series, orders] = await Promise.all([
      one(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE role = 'user')::int AS users,
                count(*) FILTER (WHERE role = 'merchant')::int AS merchants,
                count(*) FILTER (WHERE role = 'exchange')::int AS exchanges,
                count(*) FILTER (WHERE role = 'admin')::int AS admins,
                count(*) FILTER (WHERE status = 'suspended')::int AS suspended,
                count(*) FILTER (WHERE totp_enabled)::int AS with_2fa,
                count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS new_7d
           FROM ${S}.users WHERE email NOT LIKE 'deleted+%@deleted.invalid'`,
      ),
      one(`SELECT COALESCE(SUM(balance), 0)::text AS wallets_total, count(*)::int AS wallets, count(*) FILTER (WHERE is_frozen)::int AS frozen FROM ${S}.wallets`),
      one(
        `SELECT count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS tx_24h,
                COALESCE(SUM(amount) FILTER (WHERE amount > 0 AND created_at > now() - interval '24 hours'), 0)::text AS volume_24h
           FROM ${S}.transactions WHERE status = 'completed'`,
      ),
      one(
        `SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending, count(*) FILTER (WHERE status = 'failed')::int AS failed
           FROM ${S}.bank_operations`,
      ),
      pool.query(
        `WITH days AS (SELECT generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') AS d)
         SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::text AS volume, count(t.id)::int AS count
           FROM days LEFT JOIN ${S}.transactions t ON date_trunc('day', t.created_at) = days.d AND t.status = 'completed'
          GROUP BY d ORDER BY d`,
      ),
      one(`SELECT count(*)::int AS total, COALESCE(SUM(total_amount) FILTER (WHERE escrow_status = 'held'), 0)::text AS escrow FROM ${S}.orders`),
    ]);
    res.json({ success: true, data: { users, money, activity, bankOperations: ops, series: series.rows, orders } });
  }),
);

/**
 * Proof of reserves: every unit in a wallet must be backed by money sitting in
 * the exchange account at TalerBank (minus vouchers in escrow, which are
 * already deducted from wallets).
 */
adminRouter.get(
  '/reconciliation',
  requirePerm('bank.ops'),
  ah(async (_req, res) => {
    const wallets = await one<{ total: string }>(`SELECT COALESCE(SUM(balance), 0)::text AS total FROM ${S}.wallets`);
    const vouchers = await one<{ total: string }>(`SELECT COALESCE(SUM(amount), 0)::text AS total FROM ${S}.exchange_vouchers WHERE status = 'active'`);
    const pendingDeposits = await one<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total FROM ${S}.bank_operations WHERE kind = 'deposit' AND status = 'pending'`,
    );
    const escrow = await one<{ total: string }>(
      `SELECT COALESCE(SUM(total_amount), 0)::text AS total FROM ${S}.orders WHERE escrow_status = 'held' AND payment_status = 'completed'`,
    );
    let bankSide: any = null;
    let bankError: string | null = null;
    try {
      bankSide = await bank.exchangeAccount();
    } catch (e: any) {
      bankError = e?.message ?? 'unreachable';
    }
    res.json({
      success: true,
      data: {
        walletsTotal: wallets?.total,
        vouchersInEscrow: vouchers?.total,
        pendingDeposits: pendingDeposits?.total,
        escrowHeld: escrow?.total,
        exchangeAccount: bankSide,
        bankError,
        currency: env.CURRENCY,
      },
    });
  }),
);

adminRouter.get(
  '/users',
  requirePerm('users.view'),
  validate({
    query: pageQuery
      .extend({
        q: z.string().trim().max(64).optional(),
        role: z.enum(['user', 'merchant', 'exchange', 'admin']).optional(),
        status: z.enum(['active', 'suspended']).optional(),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const f = req.query as any;
    const params: unknown[] = [];
    const where = [`u.email NOT LIKE 'deleted+%@deleted.invalid'`];
    if (f.q) {
      params.push(like(f.q));
      where.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR w.wallet_id ILIKE $${params.length})`);
    }
    if (f.role) {
      params.push(f.role);
      where.push(`u.role = $${params.length}`);
    }
    if (f.status) {
      params.push(f.status);
      where.push(`u.status = $${params.length}`);
    }
    params.push(f.limit, f.offset);
    const r = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.role, u.admin_level, u.status, u.totp_enabled, u.created_at, u.last_login_at, u.profile_image,
              w.wallet_id, w.balance, w.is_frozen, COUNT(*) OVER() AS total
         FROM ${S}.users u
         LEFT JOIN LATERAL (SELECT wallet_id, balance, is_frozen FROM ${S}.wallets WHERE user_id = u.id ORDER BY created_at NULLS LAST LIMIT 1) w ON true
        WHERE ${where.join(' AND ')} ORDER BY u.created_at DESC NULLS LAST LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({ success: true, data: { users: r.rows.map(({ total, ...u }) => u), total: Number(r.rows[0]?.total ?? 0) } });
  }),
);

adminRouter.get(
  '/users/:id',
  requirePerm('users.view'),
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const user = await one<any>(
      `SELECT u.id, u.full_name, u.email, u.role, u.admin_level, u.admin_permissions, u.status, u.phone_number, u.language, u.totp_enabled, u.email_verified,
              u.failed_login_count, u.locked_until, u.created_at, u.last_login_at, u.profile_image
         FROM ${S}.users u WHERE u.id = $1`,
      [req.params.id],
    );
    if (!user) throw notFound('User not found');
    const wallet = await one(`SELECT id, wallet_id, balance, currency, is_frozen, created_at FROM ${S}.wallets WHERE user_id = $1 ORDER BY created_at LIMIT 1`, [req.params.id]);
    const tr = await pool.query(
      `SELECT id, transaction_type AS type, amount, status, description, created_at FROM ${S}.transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 25`,
      [req.params.id],
    );
    const merchant = await one(`SELECT id, store_name, status FROM ${S}.merchants WHERE user_id = $1 LIMIT 1`, [req.params.id]);
    const link = await one(`SELECT bank_iban, bank_holder, created_at FROM ${S}.bank_accounts WHERE user_id = $1 AND status = 'active' LIMIT 1`, [req.params.id]);
    res.json({ success: true, data: { user, wallet, transactions: tr.rows, merchant, bankLink: link } });
  }),
);

/** Edit any regular account: profile, e-mail, status and (user/merchant/exchange) role. Each field needs its permission. */
adminRouter.patch(
  '/users/:id',
  validate({
    params: z.object({ id: idParam }).strict(),
    body: z
      .object({
        fullName: fullName.optional(),
        email: email.optional(),
        phoneNumber: z.string().trim().regex(/^\+?[0-9 ]{7,20}$/, 'Invalid phone number').nullable().optional(),
        language: z.enum(['en', 'ar']).optional(),
        status: z.enum(['active', 'suspended']).optional(),
        role: z.enum(['user', 'merchant']).optional(),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const b = req.body;
    const target = await one<any>(`SELECT id, email, role, admin_level, language FROM ${S}.users WHERE id = $1`, [req.params.id]);
    if (!target) throw notFound('User not found');
    assertCanManage(req, target);
    const need: string[] = [];
    if (b.fullName !== undefined || b.email !== undefined || b.phoneNumber !== undefined || b.language !== undefined) need.push('users.edit');
    if (b.status !== undefined) need.push('users.status');
    if (b.role !== undefined) need.push('users.role');
    for (const p of need) if (!isSuper(req) && !(req.auth!.permissions ?? []).includes(p)) throw forbidden('You do not have permission for this action', 'NO_PERMISSION');
    if (b.role && target.role === 'admin') throw forbidden('Use the administrators page to change an admin', 'ADMIN_TARGET');
    if (b.email && b.email !== target.email.toLowerCase()) {
      if (await one(`SELECT 1 FROM ${S}.users WHERE lower(email) = $1 AND id <> $2`, [b.email, target.id])) throw conflict('EMAIL_TAKEN', 'This e-mail is already registered');
    }
    await pool.query(
      `UPDATE ${S}.users SET full_name = COALESCE($2, full_name), email = COALESCE($3, email),
              phone_number = CASE WHEN $4 THEN $5 ELSE phone_number END, language = COALESCE($6, language),
              status = COALESCE($7, status), role = COALESCE($8, role),
              email_verified = CASE WHEN $3::text IS NOT NULL THEN true ELSE email_verified END,
              token_version = token_version + CASE WHEN $7::text IS NOT NULL OR $8::text IS NOT NULL THEN 1 ELSE 0 END,
              updated_at = now()
        WHERE id = $1`,
      [target.id, b.fullName ?? null, b.email ?? null, b.phoneNumber !== undefined, b.phoneNumber ?? null, b.language ?? null, b.status ?? null, b.role ?? null],
    );
    forgetUser(target.id);
    if (b.status === 'suspended') await revokeAllSessions(target.id);
    if (b.email && b.email !== target.email.toLowerCase()) {
      await sendMail(noticeMail(target.email, 'E-mail changed', `An administrator changed the e-mail on your account to ${b.email}.`, target.language ?? 'en'));
    }
    await audit({ userId: req.auth!.userId, action: 'admin.user_updated', entityType: 'user', entityId: target.id, details: b }, req);
    res.json({ success: true });
  }),
);

/** Set a new password for a user (signs them out everywhere and tells them by e-mail). */
adminRouter.post(
  '/users/:id/password',
  requirePerm('users.password'),
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ password: passwordSchema }).strict() }),
  ah(async (req, res) => {
    const target = await one<any>(`SELECT id, email, role, admin_level, language FROM ${S}.users WHERE id = $1`, [req.params.id]);
    if (!target) throw notFound('User not found');
    assertCanManage(req, target);
    await pool.query(`UPDATE ${S}.users SET password_hash = $2, password_changed_at = now(), failed_login_count = 0, locked_until = NULL WHERE id = $1`, [
      target.id,
      await hashPassword(req.body.password),
    ]);
    await revokeAllSessions(target.id);
    await sendMail(noticeMail(target.email, 'Password changed', 'An administrator set a new password on your account. You were signed out everywhere.', target.language ?? 'en'));
    await audit({ userId: req.auth!.userId, action: 'admin.password_set', entityType: 'user', entityId: target.id }, req);
    res.json({ success: true });
  }),
);

const message = z.object({ title: z.string().trim().min(2).max(80), body: z.string().trim().min(2).max(500) }).strict();

/** In-app notification to one user. */
adminRouter.post(
  '/users/:id/notify',
  requirePerm('notify'),
  validate({ params: z.object({ id: idParam }).strict(), body: message }),
  ah(async (req, res) => {
    const target = await one<any>(`SELECT id FROM ${S}.users WHERE id = $1`, [req.params.id]);
    if (!target) throw notFound('User not found');
    await notify(undefined, target.id, 'admin_message', req.body.title, req.body.body);
    await audit({ userId: req.auth!.userId, action: 'admin.user_notified', entityType: 'user', entityId: target.id }, req);
    res.json({ success: true });
  }),
);

/** In-app notification to everyone (optionally one role). */
adminRouter.post(
  '/broadcast',
  requirePerm('notify'),
  validate({ body: message.extend({ role: z.enum(['user', 'merchant', 'exchange', 'admin']).optional() }).strict() }),
  ah(async (req, res) => {
    const r = await pool.query(
      `INSERT INTO ${S}.notifications (user_id, type, title, body, metadata)
       SELECT id, 'admin_message', $1, $2, '{}'::jsonb FROM ${S}.users
        WHERE status = 'active' AND email NOT LIKE 'deleted+%@deleted.invalid' AND ($3::text IS NULL OR role = $3)`,
      [req.body.title, req.body.body, req.body.role ?? null],
    );
    await audit({ userId: req.auth!.userId, action: 'admin.broadcast', details: { title: req.body.title, role: req.body.role ?? 'all', count: r.rowCount } }, req);
    res.json({ success: true, data: { sent: r.rowCount } });
  }),
);

// ---------------------------------------------------------- administrators
/** The list of permissions the UI can offer. */
adminRouter.get('/permissions', (_req, res) => res.json({ success: true, data: { permissions: PERMISSIONS } }));

adminRouter.get(
  '/admins',
  requirePerm('admins.manage'),
  ah(async (_req, res) => {
    const r = await pool.query(
      `SELECT id, full_name, email, admin_level, admin_permissions, status, totp_enabled, last_login_at, created_at
         FROM ${S}.users WHERE role = 'admin' ORDER BY (admin_level = 'super_admin') DESC, created_at`,
    );
    res.json({ success: true, data: { admins: r.rows } });
  }),
);

const permList = z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length);

/** Make an admin: promote an existing account by e-mail, or create a new one (then a password is required). */
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
      if (existing.admin_level === 'super_admin') throw forbidden('The super admin account cannot be changed here', 'SUPER_ADMIN');
      await pool.query(
        `UPDATE ${S}.users SET role = 'admin', admin_level = 'admin', admin_permissions = $2, token_version = token_version + 1 WHERE id = $1`,
        [existing.id, perms],
      );
      id = existing.id;
    } else {
      if (!b.password || !b.fullName) throw conflict('NEW_ADMIN_DETAILS', 'Name and password are required for a new account');
      id = await tx(async (c) => {
        const u = await one<any>(
          `INSERT INTO ${S}.users (email, password_hash, full_name, role, admin_level, admin_permissions, email_verified, email_verified_at, verification_method, password_changed_at)
           VALUES ($1, $2, $3, 'admin', 'admin', $4, true, now(), 'email', now()) RETURNING id`,
          [b.email, await hashPassword(b.password), b.fullName, perms],
          c,
        );
        await createWallet(c, u.id);
        return u.id;
      });
    }
    forgetUser(id);
    await audit({ userId: req.auth!.userId, action: 'admin.admin_granted', entityType: 'user', entityId: id, details: { permissions: perms } }, req);
    res.status(201).json({ success: true, data: { id } });
  }),
);

adminRouter.patch(
  '/admins/:id',
  requirePerm('admins.manage'),
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ permissions: permList }).strict() }),
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

/** Remove admin rights (the account stays as a regular user). */
adminRouter.delete(
  '/admins/:id',
  requirePerm('admins.manage'),
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const t = await one<any>(`SELECT id, role, admin_level FROM ${S}.users WHERE id = $1`, [req.params.id]);
    if (!t || t.role !== 'admin') throw notFound('Administrator not found');
    if (t.admin_level === 'super_admin') throw forbidden('The super admin cannot be removed', 'SUPER_ADMIN');
    await pool.query(
      `UPDATE ${S}.users SET role = 'user', admin_level = NULL, admin_permissions = '{}', token_version = token_version + 1 WHERE id = $1`,
      [t.id],
    );
    forgetUser(t.id);
    await revokeAllSessions(t.id);
    await audit({ userId: req.auth!.userId, action: 'admin.admin_revoked', entityType: 'user', entityId: t.id }, req);
    res.json({ success: true });
  }),
);

adminRouter.post(
  '/users',
  requirePerm('users.edit'),
  validate({
    body: z
      .object({
        fullName,
        email,
        password: passwordSchema,
        role: z.enum(['user', 'merchant']).default('user'),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const b = req.body;
    if (await one(`SELECT 1 FROM ${S}.users WHERE lower(email) = $1`, [b.email])) throw conflict('EMAIL_TAKEN', 'This e-mail is already registered');
    const user = await tx(async (c) => {
      const u = await one<any>(
        `INSERT INTO ${S}.users (email, password_hash, full_name, role, admin_level, email_verified, email_verified_at, verification_method, password_changed_at)
         VALUES ($1, $2, $3, $4, $5, true, now(), 'email', now()) RETURNING id, email, full_name, role, admin_level`,
        [b.email, await hashPassword(b.password), b.fullName, b.role, null],
        c,
      );
      const w = await createWallet(c, u.id);
      return { ...u, wallet_id: w.wallet_id };
    });
    await audit({ userId: req.auth!.userId, action: 'admin.user_created', entityType: 'user', entityId: user.id, details: { role: b.role } }, req);
    res.status(201).json({ success: true, data: { user } });
  }),
);

adminRouter.post(
  '/users/:id/revoke-sessions',
  requirePerm('users.security'),
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const target = await one<any>(`SELECT id, role, admin_level FROM ${S}.users WHERE id = $1`, [req.params.id]);
    if (!target) throw notFound('User not found');
    assertCanManage(req, target);
    await revokeAllSessions(req.params.id!);
    await audit({ userId: req.auth!.userId, action: 'admin.sessions_revoked', entityType: 'user', entityId: req.params.id }, req);
    res.json({ success: true });
  }),
);

adminRouter.post(
  '/users/:id/reset-2fa',
  requirePerm('users.security'),
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ totp: totpCode.optional() }).strict() }),
  ah(async (req, res) => {
    await requireSecondFactor(req.auth!.userId, req.body.totp);
    const t = await one<any>(`SELECT id, role, admin_level FROM ${S}.users WHERE id = $1`, [req.params.id]);
    if (!t) throw notFound('User not found');
    assertCanManage(req, t);
    await pool.query(
      `UPDATE ${S}.users SET totp_enabled = false, totp_secret_enc = NULL, totp_last_step = NULL, totp_recovery_hashes = '{}', token_version = token_version + 1 WHERE id = $1`,
      [req.params.id],
    );
    forgetUser(req.params.id);
    await audit({ userId: req.auth!.userId, action: 'admin.2fa_reset', entityType: 'user', entityId: req.params.id }, req);
    res.json({ success: true });
  }),
);

/** E-mail the user a reset code so they choose their own new password. */
adminRouter.post(
  '/users/:id/send-reset',
  requirePerm('users.password'),
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const u = await one<any>(`SELECT id, email, language, role, admin_level FROM ${S}.users WHERE id = $1 AND status = 'active'`, [req.params.id]);
    if (!u) throw notFound('User not found');
    assertCanManage(req, u);
    const code = numericCode(6);
    await pool.query(`UPDATE ${S}.password_resets SET used = true WHERE user_id = $1 AND used = false`, [u.id]);
    await pool.query(
      `INSERT INTO ${S}.password_resets (user_id, email, reset_code, used, expires_at) VALUES ($1, $2, $3, false, now() + interval '15 minutes')`,
      [u.id, u.email, codeHash('reset', u.email.toLowerCase(), code)],
    );
    await sendMail(codeMail(u.email, 'reset', code, u.language ?? 'en'));
    await audit({ userId: req.auth!.userId, action: 'admin.reset_sent', entityType: 'user', entityId: req.params.id }, req);
    res.json({ success: true });
  }),
);

adminRouter.delete(
  '/users/:id',
  requirePerm('users.delete'),
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const t = await one<any>(`SELECT id, role, admin_level FROM ${S}.users WHERE id = $1`, [req.params.id]);
    if (!t) throw notFound('User not found');
    assertCanManage(req, t);
    const w = await one(`SELECT 1 FROM ${S}.wallets WHERE user_id = $1 AND balance <> 0`, [req.params.id]);
    if (w) throw conflict('BALANCE_NOT_ZERO', 'The wallet still holds money');
    await anonymiseUser(req.params.id!);
    await audit({ userId: req.auth!.userId, action: 'admin.user_deleted', entityType: 'user', entityId: req.params.id }, req);
    res.json({ success: true });
  }),
);

adminRouter.post(
  '/wallets/:walletId/freeze',
  requirePerm('wallets.freeze'),
  validate({ params: z.object({ walletId: z.string().regex(/^[A-Za-z0-9_]{4,64}$/) }).strict(), body: z.object({ frozen: z.boolean() }).strict() }),
  ah(async (req, res) => {
    const r = await pool.query(`UPDATE ${S}.wallets SET is_frozen = $2 WHERE wallet_id = $1`, [req.params.walletId, req.body.frozen]);
    if (r.rowCount === 0) throw notFound('Wallet not found');
    await audit({ userId: req.auth!.userId, action: req.body.frozen ? 'admin.wallet_frozen' : 'admin.wallet_unfrozen', entityType: 'wallet', entityId: req.params.walletId }, req);
    res.json({ success: true });
  }),
);

adminRouter.get(
  '/pending-users',
  requirePerm('pending.manage'),
  ah(async (_req, res) => {
    const r = await pool.query(
      `SELECT id, email, full_name, role, attempts, code_expires_at, expires_at, created_at FROM ${S}.pending_users ORDER BY created_at DESC LIMIT 200`,
    );
    res.json({ success: true, data: { pendingUsers: r.rows } });
  }),
);

adminRouter.delete(
  '/pending-users/:id',
  requirePerm('pending.manage'),
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    await pool.query(`DELETE FROM ${S}.pending_users WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  }),
);

adminRouter.delete(
  '/pending-users',
  requirePerm('pending.manage'),
  ah(async (_req, res) => {
    const r = await pool.query(`DELETE FROM ${S}.pending_users WHERE expires_at < now()`);
    res.json({ success: true, data: { deleted: r.rowCount } });
  }),
);

adminRouter.get(
  '/stores',
  requirePerm('stores.manage'),
  ah(async (_req, res) => {
    const r = await pool.query(
      `SELECT m.id, m.store_name, m.description, COALESCE(m.status,'active') AS status, m.created_at, u.full_name AS owner, u.email AS owner_email,
              (SELECT count(*)::int FROM ${S}.products p WHERE p.merchant_id = m.id AND COALESCE(p.status,'active') = 'active') AS products,
              (SELECT COALESCE(SUM(total_amount),0)::text FROM ${S}.orders o WHERE o.merchant_id = m.id AND o.escrow_status = 'released') AS revenue
         FROM ${S}.merchants m LEFT JOIN ${S}.users u ON u.id = m.user_id ORDER BY m.created_at DESC NULLS LAST`,
    );
    res.json({ success: true, data: { stores: r.rows } });
  }),
);

adminRouter.patch(
  '/stores/:id',
  requirePerm('stores.manage'),
  validate({
    params: z.object({ id: idParam }).strict(),
    body: z
      .object({ storeName: z.string().trim().min(2).max(60).optional(), description: z.string().trim().max(500).optional(), status: z.enum(['active', 'suspended']).optional() })
      .strict(),
  }),
  ah(async (req, res) => {
    const r = await pool.query(
      `UPDATE ${S}.merchants SET store_name = COALESCE($2, store_name), description = COALESCE($3, description), status = COALESCE($4, status) WHERE id = $1`,
      [req.params.id, req.body.storeName ?? null, req.body.description ?? null, req.body.status ?? null],
    );
    if (r.rowCount === 0) throw notFound('Store not found');
    await audit({ userId: req.auth!.userId, action: 'admin.store_updated', entityType: 'store', entityId: req.params.id, details: req.body }, req);
    res.json({ success: true });
  }),
);

adminRouter.get(
  '/settings',
  requirePerm('settings.manage'),
  ah(async (_req, res) => {
    const s = await one(`SELECT site_name, currency, theme, maintenance_mode, allow_registrations, announcement FROM ${S}.system_settings WHERE id = 1`);
    res.json({ success: true, data: { settings: s } });
  }),
);

adminRouter.put(
  '/settings',
  requirePerm('settings.manage'),
  validate({
    body: z
      .object({
        siteName: z.string().trim().min(2).max(60).optional(),
        theme: z.enum(['emerald', 'ocean', 'violet', 'sunset']).optional(),
        maintenanceMode: z.boolean().optional(),
        allowRegistrations: z.boolean().optional(),
        announcement: z.string().trim().max(280).nullable().optional(),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const b = req.body;
    await pool.query(
      `INSERT INTO ${S}.system_settings (id, site_name, currency, theme) VALUES (1, 'S-Taler', $1, 'emerald') ON CONFLICT (id) DO NOTHING`,
      [env.CURRENCY],
    );
    await pool.query(
      `UPDATE ${S}.system_settings SET site_name = COALESCE($1, site_name), theme = COALESCE($2, theme),
              maintenance_mode = COALESCE($3, maintenance_mode), allow_registrations = COALESCE($4, allow_registrations),
              announcement = CASE WHEN $6 THEN $5 ELSE announcement END, updated_at = now() WHERE id = 1`,
      [b.siteName ?? null, b.theme ?? null, b.maintenanceMode ?? null, b.allowRegistrations ?? null, b.announcement ?? null, b.announcement !== undefined],
    );
    await audit({ userId: req.auth!.userId, action: 'admin.settings_updated', details: b }, req);
    res.json({ success: true });
  }),
);

adminRouter.get(
  '/audit',
  requirePerm('audit.view'),
  validate({ query: pageQuery.extend({ action: z.string().max(64).optional() }).strict() }),
  ah(async (req, res) => {
    const f = req.query as any;
    const params: unknown[] = [];
    let where = 'true';
    if (f.action) {
      params.push(like(f.action));
      where = 'l.action ILIKE $1';
    }
    params.push(f.limit, f.offset);
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
  '/bank-operations',
  requirePerm('bank.ops'),
  ah(async (_req, res) => {
    const r = await pool.query(
      `SELECT o.id, o.kind, o.status, o.amount, o.error, o.attempts, o.created_at, o.completed_at, u.email
         FROM ${S}.bank_operations o JOIN ${S}.users u ON u.id = o.user_id ORDER BY o.created_at DESC LIMIT 100`,
    );
    res.json({ success: true, data: { operations: r.rows } });
  }),
);

adminRouter.post(
  '/bank-operations/reconcile',
  requirePerm('bank.ops'),
  ah(async (req, res) => {
    const result = await reconcilePending();
    await audit({ userId: req.auth!.userId, action: 'admin.reconcile' }, req);
    res.json({ success: true, data: result });
  }),
);


// --------------------------------------------------------------- disputes
adminRouter.get(
  '/disputes',
  requirePerm('orders.disputes'),
  ah(async (_req, res) => {
    const r = await pool.query(
      `SELECT o.id, o.total_amount, o.amount_paid, o.balance_due, o.status, o.escrow_status, o.dispute_status, o.dispute_reason, o.created_at, o.fulfillment,
              o.delivery_address, m.store_name, m.branch_name, mu.full_name AS merchant_name, bu.full_name AS buyer_name, bu.email AS buyer_email,
              COALESCE((SELECT json_agg(json_build_object('kind', e.kind, 'actor', e.actor, 'note', e.note, 'at', e.created_at) ORDER BY e.created_at)
                          FROM ${S}.order_events e WHERE e.order_id = o.id), '[]') AS events
         FROM ${S}.orders o JOIN ${S}.merchants m ON m.id = o.merchant_id JOIN ${S}.users mu ON mu.id = m.user_id JOIN ${S}.users bu ON bu.id = o.user_id
        WHERE o.dispute_status IS NOT NULL ORDER BY (o.dispute_status = 'open') DESC, o.updated_at DESC LIMIT 100`,
    );
    res.json({ success: true, data: { disputes: r.rows } });
  }),
);

adminRouter.post(
  '/orders/:id/resolve',
  requirePerm('orders.disputes'),
  validate({
    params: z.object({ id: idParam }).strict(),
    body: z.object({ outcome: z.enum(['release', 'refund']), note: z.string().trim().min(3).max(300) }).strict(),
  }),
  ah(async (req, res) => {
    const done = await tx(async (c) => {
      const o = await one<any>(`SELECT id, escrow_status, dispute_status, user_id FROM ${S}.orders WHERE id = $1 FOR UPDATE`, [req.params.id], c);
      if (!o) throw notFound('Order not found');
      if (o.escrow_status !== 'held') throw conflict('ALREADY_SETTLED', 'This order is already settled');
      await c.query(`UPDATE ${S}.orders SET dispute_status = 'resolved', updated_at = now() WHERE id = $1`, [o.id]);
      await addEvent(c, o.id, 'resolved', 'admin', { note: `${req.body.outcome}: ${req.body.note}` });
      return req.body.outcome === 'release'
        ? releaseEscrow(c, o.id, `dispute resolved: ${req.body.note}`, 'admin')
        : refundOrder(c, o.id, `dispute resolved: ${req.body.note}`, { actor: 'admin' });
    });
    if (!done) throw conflict('ALREADY_SETTLED', 'This order is already settled');
    await audit({ userId: req.auth!.userId, action: `admin.dispute_${req.body.outcome}`, entityType: 'order', entityId: req.params.id, details: { note: req.body.note } }, req);
    res.json({ success: true });
  }),
);

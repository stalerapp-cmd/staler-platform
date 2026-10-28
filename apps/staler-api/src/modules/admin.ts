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
import { requireSecondFactor } from './mfa.js';
import { revokeAllSessions } from './sessions.js';
import { anonymiseUser } from './auth.js';
import { createWallet } from './walletCore.js';
import { idParam } from './commerce.js';
import { reconcilePending } from './bank.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));

const like = (q: string) => `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
const isSuper = (req: any) => req.auth?.adminLevel === 'super_admin';

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
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const user = await one<any>(
      `SELECT u.id, u.full_name, u.email, u.role, u.admin_level, u.status, u.phone_number, u.language, u.totp_enabled, u.email_verified,
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

adminRouter.patch(
  '/users/:id',
  validate({
    params: z.object({ id: idParam }).strict(),
    body: z
      .object({
        fullName: fullName.optional(),
        status: z.enum(['active', 'suspended']).optional(),
        role: z.enum(['user', 'merchant', 'exchange', 'admin']).optional(),
        adminLevel: z.enum(['admin', 'super_admin']).optional(),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    if (String(req.params.id) === String(req.auth!.userId)) throw forbidden('You cannot change your own account here');
    const target = await one<any>(`SELECT id, role, admin_level FROM ${S}.users WHERE id = $1`, [req.params.id]);
    if (!target) throw notFound('User not found');
    const b = req.body;
    // Privilege rules: only a super admin can create admins or touch existing admins.
    const touchesAdmin = target.role === 'admin' || b.role === 'admin' || b.adminLevel !== undefined;
    if (touchesAdmin && !isSuper(req)) throw forbidden('Only a super admin can manage administrators');
    if (target.admin_level === 'super_admin' && (b.status === 'suspended' || (b.role && b.role !== 'admin'))) {
      const supers = await one<{ n: string }>(`SELECT count(*)::text AS n FROM ${S}.users WHERE admin_level = 'super_admin' AND status = 'active'`);
      if (Number(supers?.n ?? 0) <= 1) throw conflict('LAST_SUPER_ADMIN', 'At least one super admin must remain');
    }
    const role = b.role ?? null;
    const adminLevel = b.role && b.role !== 'admin' ? null : (b.adminLevel ?? (b.role === 'admin' ? 'admin' : undefined));
    await pool.query(
      `UPDATE ${S}.users SET full_name = COALESCE($2, full_name), status = COALESCE($3, status), role = COALESCE($4, role),
              admin_level = CASE WHEN $6 THEN $5 ELSE admin_level END,
              token_version = token_version + CASE WHEN $3::text IS NOT NULL OR $4::text IS NOT NULL OR $6 THEN 1 ELSE 0 END
        WHERE id = $1`,
      [req.params.id, b.fullName ?? null, b.status ?? null, role, adminLevel ?? null, adminLevel !== undefined],
    );
    if (b.status === 'suspended') await revokeAllSessions(req.params.id!);
    await audit({ userId: req.auth!.userId, action: 'admin.user_updated', entityType: 'user', entityId: req.params.id, details: b }, req);
    res.json({ success: true });
  }),
);

adminRouter.post(
  '/users',
  validate({
    body: z
      .object({
        fullName,
        email,
        password: passwordSchema,
        role: z.enum(['user', 'merchant', 'exchange', 'admin']).default('user'),
        adminLevel: z.enum(['admin', 'super_admin']).optional(),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const b = req.body;
    if (b.role === 'admin' && !isSuper(req)) throw forbidden('Only a super admin can create administrators');
    if (await one(`SELECT 1 FROM ${S}.users WHERE lower(email) = $1`, [b.email])) throw conflict('EMAIL_TAKEN', 'This e-mail is already registered');
    const user = await tx(async (c) => {
      const u = await one<any>(
        `INSERT INTO ${S}.users (email, password_hash, full_name, role, admin_level, email_verified, email_verified_at, verification_method, password_changed_at)
         VALUES ($1, $2, $3, $4, $5, true, now(), 'email', now()) RETURNING id, email, full_name, role, admin_level`,
        [b.email, await hashPassword(b.password), b.fullName, b.role, b.role === 'admin' ? (b.adminLevel ?? 'admin') : null],
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
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    await revokeAllSessions(req.params.id!);
    await audit({ userId: req.auth!.userId, action: 'admin.sessions_revoked', entityType: 'user', entityId: req.params.id }, req);
    res.json({ success: true });
  }),
);

adminRouter.post(
  '/users/:id/reset-2fa',
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ totp: totpCode.optional() }).strict() }),
  ah(async (req, res) => {
    await requireSecondFactor(req.auth!.userId, req.body.totp);
    const t = await one<any>(`SELECT role FROM ${S}.users WHERE id = $1`, [req.params.id]);
    if (!t) throw notFound('User not found');
    if (t.role === 'admin' && !isSuper(req)) throw forbidden('Only a super admin can manage administrators');
    await pool.query(
      `UPDATE ${S}.users SET totp_enabled = false, totp_secret_enc = NULL, totp_last_step = NULL, totp_recovery_hashes = '{}', token_version = token_version + 1 WHERE id = $1`,
      [req.params.id],
    );
    await audit({ userId: req.auth!.userId, action: 'admin.2fa_reset', entityType: 'user', entityId: req.params.id }, req);
    res.json({ success: true });
  }),
);

/** Admins never see or set passwords: they can only trigger the user's own reset e-mail. */
adminRouter.post(
  '/users/:id/send-reset',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const u = await one<any>(`SELECT id, email, language FROM ${S}.users WHERE id = $1 AND status = 'active'`, [req.params.id]);
    if (!u) throw notFound('User not found');
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
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    if (String(req.params.id) === String(req.auth!.userId)) throw forbidden('You cannot delete yourself');
    const t = await one<any>(`SELECT role, admin_level FROM ${S}.users WHERE id = $1`, [req.params.id]);
    if (!t) throw notFound('User not found');
    if (t.role === 'admin' && !isSuper(req)) throw forbidden('Only a super admin can manage administrators');
    if (t.admin_level === 'super_admin') throw forbidden('A super admin cannot be deleted');
    const w = await one(`SELECT 1 FROM ${S}.wallets WHERE user_id = $1 AND balance <> 0`, [req.params.id]);
    if (w) throw conflict('BALANCE_NOT_ZERO', 'The wallet still holds money');
    await anonymiseUser(req.params.id!);
    await audit({ userId: req.auth!.userId, action: 'admin.user_deleted', entityType: 'user', entityId: req.params.id }, req);
    res.json({ success: true });
  }),
);

adminRouter.post(
  '/wallets/:walletId/freeze',
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
  ah(async (_req, res) => {
    const r = await pool.query(
      `SELECT id, email, full_name, role, attempts, code_expires_at, expires_at, created_at FROM ${S}.pending_users ORDER BY created_at DESC LIMIT 200`,
    );
    res.json({ success: true, data: { pendingUsers: r.rows } });
  }),
);

adminRouter.delete(
  '/pending-users/:id',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    await pool.query(`DELETE FROM ${S}.pending_users WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  }),
);

adminRouter.delete(
  '/pending-users',
  ah(async (_req, res) => {
    const r = await pool.query(`DELETE FROM ${S}.pending_users WHERE expires_at < now()`);
    res.json({ success: true, data: { deleted: r.rowCount } });
  }),
);

adminRouter.get(
  '/stores',
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
  ah(async (_req, res) => {
    const s = await one(`SELECT site_name, currency, theme, maintenance_mode, allow_registrations, announcement FROM ${S}.system_settings WHERE id = 1`);
    res.json({ success: true, data: { settings: s } });
  }),
);

adminRouter.put(
  '/settings',
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
  ah(async (req, res) => {
    const result = await reconcilePending();
    await audit({ userId: req.auth!.userId, action: 'admin.reconcile' }, req);
    res.json({ success: true, data: result });
  }),
);


import { Router } from 'express';
import { placeOf } from '../lib/geo.js';
import { z } from 'zod';
import { leaveJson } from './leaves.js';
import { env } from '../config/env.js';
import { one, pool, S, tx } from '../lib/db.js';
import { codeHash, numericCode } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { hashPassword, passwordSchema } from '../lib/passwords.js';
import { codeMail, sendMail, sendMailNow } from '../lib/mailer.js';
import { email, fullName, pageQuery, totpCode, validate } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { bank } from '../lib/bankClient.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { PERMISSIONS, assertCanManage, can, isSuper, requirePerm } from '../lib/permissions.js';
import { noticeMail } from '../lib/mailer.js';
import { LIMIT_TYPES, dailyLimitFor, notify, notifyBi, writeLine } from './walletCore.js';
import { agentProfileBody, deliverAgentPost, refundVoucher, saveAgentProfile } from './exchange.js';
import { inPlaces, mentionLink, placeKeys, plainText } from '../lib/audience.js';
import { requireSecondFactor } from './mfa.js';
import { revokeAllSessions } from './sessions.js';
import { anonymiseUser } from './auth.js';
import { createWallet } from './walletCore.js';
import { addEvent, idParam, refundOrder, releaseEscrow } from './commerce.js';
import { reconcilePending } from './bank.js';
import { forgetUser, revokeSessionNow } from '../lib/authCache.js';

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
    const stores = await pool.query(
      `SELECT m.id, m.store_name, m.branch_name, m.parent_id, m.slug, m.logo_url, m.category, m.city, COALESCE(m.status,'active') AS status, m.created_at,
              (SELECT count(*)::int FROM ${S}.products p WHERE p.merchant_id = m.id AND COALESCE(p.status,'active') <> 'deleted') AS products,
              (SELECT count(*)::int FROM ${S}.orders o WHERE o.merchant_id = m.id) AS orders
         FROM ${S}.merchants m WHERE m.user_id = $1 ORDER BY m.parent_id NULLS FIRST, m.created_at`,
      [req.params.id],
    );
    let agent = null;
    if (user.role === 'exchange') {
      const profile = await one(`SELECT * FROM ${S}.agent_profiles WHERE user_id = $1`, [req.params.id]);
      const vouchers = await pool.query(
        `SELECT v.id, v.amount, v.description, v.created_at, v.claimed_at,
                CASE WHEN v.status = 'active' AND v.expires_at < now() THEN 'expired' ELSE v.status END AS status, u.full_name AS claimed_by_name
           FROM ${S}.exchange_vouchers v LEFT JOIN ${S}.users u ON u.id = v.claimed_by WHERE v.exchange_user_id = $1 ORDER BY v.created_at DESC LIMIT 30`,
        [req.params.id],
      );
      const cashouts = await pool.query(
        `SELECT c.id, c.amount, c.created_at, c.paid_at, CASE WHEN c.status = 'open' AND c.expires_at < now() THEN 'expired' ELSE c.status END AS status, u.full_name AS paid_by_name
           FROM ${S}.agent_cashouts c LEFT JOIN ${S}.users u ON u.id = c.paid_by WHERE c.agent_id = $1 ORDER BY c.created_at DESC LIMIT 30`,
        [req.params.id],
      );
      agent = { profile, vouchers: vouchers.rows, cashouts: cashouts.rows };
    }
    // Balances, statements and bank details are only for admins allowed to see money.
    const money = can(req, 'users.money');
    res.json({
      success: true,
      data: {
        user,
        wallet: money ? wallet : wallet ? { ...wallet, balance: null } : null,
        transactions: money ? tr.rows : [],
        moneyHidden: !money,
        merchant,
        bankLink: money ? link : link ? { bank_iban: null, bank_holder: null, created_at: (link as any).created_at } : null,
        stores: stores.rows,
        agent,
      },
    });
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
        role: z.enum(['user', 'merchant', 'exchange']).optional(),
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

/** The body may carry mentions (@[Name](store:slug)), so it allows a little more than it shows. */
const message = z.object({ title: z.string().trim().min(2).max(80), body: z.string().trim().min(2).max(1000) }).strict();

/** In-app notification to one user. */
adminRouter.post(
  '/users/:id/notify',
  requirePerm('notify'),
  validate({ params: z.object({ id: idParam }).strict(), body: message }),
  ah(async (req, res) => {
    const target = await one<any>(`SELECT id FROM ${S}.users WHERE id = $1`, [req.params.id]);
    if (!target) throw notFound('User not found');
    const link = mentionLink(req.body.body);
    await notify(undefined, target.id, 'admin_message', req.body.title, req.body.body, { from: 'admin', ...(link ? { link } : {}) });
    await audit({ userId: req.auth!.userId, action: 'admin.user_notified', entityType: 'user', entityId: target.id, details: { title: req.body.title, body: req.body.body.slice(0, 300) } }, req);
    res.json({ success: true });
  }),
);

/** In-app notification to everyone (optionally one role). */
const BROADCAST_ROLES = ['user', 'merchant', 'exchange', 'admin'] as const;
const broadcastBody = message
  .extend({
    /** Who gets it: everyone, chosen kinds of account, or chosen people. */
    audience: z.enum(['all', 'roles', 'people', 'places']).default('all'),
    roles: z.array(z.enum(BROADCAST_ROLES)).max(BROADCAST_ROLES.length).optional(),
    /** For 'places': governorates (gov:<id>) and towns (town:<name>); roles narrow it further. */
    places: z.array(z.string().trim().max(80)).max(60).optional(),
    userIds: z.array(idParam).max(200).optional(),
    /** Older clients send one role. */
    role: z.enum(BROADCAST_ROLES).optional(),
    tone: z.enum(['info', 'important', 'offer']).default('info'),
    /** Also send it by e-mail (up to 300 people). */
    email: z.boolean().default(false),
    /** Only count who would get it. */
    dryRun: z.boolean().default(false),
  })
  .strict();

/**
 * In-app announcement to everyone, to some kinds of account, or to chosen people —
 * optionally by e-mail too. With dryRun it only says how many people it would reach.
 */
adminRouter.post(
  '/broadcast',
  requirePerm('notify'),
  validate({ body: broadcastBody }),
  ah(async (req, res) => {
    const b = req.body as z.infer<typeof broadcastBody>;
    const roles = b.audience === 'roles' ? (b.roles ?? []) : b.audience === 'places' ? (b.roles?.length ? b.roles : null) : b.role ? [b.role] : null;
    const people = b.audience === 'people' ? [...new Set(b.userIds ?? [])] : null;
    const keys = b.audience === 'places' ? placeKeys(b.places ?? []) : null;
    if (roles && !roles.length) throw badRequest('NO_AUDIENCE', 'Choose who should get it');
    if (people && !people.length) throw badRequest('NO_AUDIENCE', 'Choose who should get it');
    if (keys && !keys.length) throw badRequest('NO_AUDIENCE', 'Choose who should get it');
    const where = `status = 'active' AND email NOT LIKE 'deleted+%@deleted.invalid' AND ($1::text[] IS NULL OR role = ANY($1)) AND ($2::uuid[] IS NULL OR id = ANY($2))
                   AND ($3::text[] IS NULL OR ${inPlaces('u', '$3')})`;
    const params = [roles, people, keys];
    const link = mentionLink(b.body);
    if (b.dryRun) {
      const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.users u WHERE ${where}`, params);
      return res.json({ success: true, data: { count: n?.n ?? 0 } });
    }
    const r = await pool.query(
      `INSERT INTO ${S}.notifications (user_id, type, title, body, metadata)
       SELECT id, 'admin_message', $4, $5, jsonb_build_object('tone', $6::text, 'from', 'admin') || COALESCE(jsonb_build_object('link', $7::text), '{}'::jsonb)
         FROM ${S}.users u WHERE ${where}
       RETURNING user_id`,
      [...params, b.title, b.body, b.tone, link],
    );
    let emailed = 0;
    if (b.email) {
      const to = await pool.query(`SELECT email, language FROM ${S}.users u WHERE ${where} AND email NOT LIKE '%.invalid' LIMIT 300`, params);
      emailed = to.rowCount ?? 0;
      // One by one in the background, so the mail server isn't flooded.
      const list = to.rows;
      const next = (k: number) => {
        if (k >= list.length) return;
        void sendMail(noticeMail(list[k].email, b.title, plainText(b.body), list[k].language === 'en' ? 'en' : 'ar'));
        setTimeout(() => next(k + 1), 400);
      };
      next(0);
    }
    await audit(
      {
        userId: req.auth!.userId,
        action: 'admin.broadcast',
        details: { title: b.title, body: b.body.slice(0, 300), audience: b.audience, roles, people: people?.length ?? null, places: b.audience === 'places' ? b.places : undefined, tone: b.tone, email: b.email, emailed, count: r.rowCount },
      },
      req,
    );
    res.json({ success: true, data: { sent: r.rowCount, emailed } });
  }),
);

/** People, stores and cash agents an announcement can mention. */
adminRouter.get(
  '/mentionables',
  requirePerm('notify'),
  validate({ query: z.object({ q: z.string().trim().min(1).max(60) }).strict() }),
  ah(async (req, res) => {
    const like = `%${String(req.query.q).replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const [stores, agents, people] = await Promise.all([
      pool.query(
        `SELECT m.slug, m.store_name AS name, m.logo_url AS image, m.city FROM ${S}.merchants m
          WHERE m.status = 'active' AND m.slug IS NOT NULL AND (m.store_name ILIKE $1 OR m.slug ILIKE $1) ORDER BY m.parent_id NULLS FIRST, m.store_name LIMIT 5`,
        [like],
      ),
      pool.query(
        `SELECT a.user_id AS id, a.display_name AS name, COALESCE(a.logo_url, u.profile_image) AS image, a.city FROM ${S}.agent_profiles a JOIN ${S}.users u ON u.id = a.user_id
          WHERE a.status = 'active' AND u.role = 'exchange' AND (a.display_name ILIKE $1 OR u.full_name ILIKE $1) ORDER BY a.display_name LIMIT 5`,
        [like],
      ),
      pool.query(
        `SELECT id, full_name AS name, profile_image AS image, role, email FROM ${S}.users
          WHERE status = 'active' AND role <> 'admin' AND email NOT LIKE '%.invalid' AND (full_name ILIKE $1 OR email ILIKE $1) ORDER BY full_name LIMIT 6`,
        [like],
      ),
    ]);
    res.json({
      success: true,
      data: {
        items: [
          ...stores.rows.map((x) => ({ kind: 'store', ref: x.slug, name: x.name, image: x.image, sub: x.city })),
          ...agents.rows.map((x) => ({ kind: 'agent', ref: x.id, name: x.name, image: x.image, sub: x.city })),
          ...people.rows.map((x) => ({ kind: 'user', ref: x.id, name: x.name, image: x.image, sub: x.email, role: x.role })),
        ],
      },
    });
  }),
);

/** Cash agents asking to announce something to everyone in their area. */
adminRouter.get(
  '/agent-posts',
  requirePerm('notify'),
  ah(async (_req, res) => {
    const r = await pool.query(
      `SELECT p.id, p.kind, p.title, p.body, p.places, p.status, p.reach, p.note, p.created_at, p.decided_at, p.agent_id,
              COALESCE(a.display_name, u.full_name) AS agent_name, COALESCE(a.logo_url, u.profile_image) AS agent_image, a.city AS agent_city, d.full_name AS decided_by_name
         FROM ${S}.agent_posts p JOIN ${S}.users u ON u.id = p.agent_id LEFT JOIN ${S}.agent_profiles a ON a.user_id = p.agent_id
         LEFT JOIN ${S}.users d ON d.id = p.decided_by
        WHERE p.audience = 'area' AND (p.status = 'pending' OR p.decided_at > now() - interval '30 days')
        ORDER BY (p.status = 'pending') DESC, p.created_at DESC LIMIT 40`,
    );
    const counts = await Promise.all(
      r.rows.filter((x) => x.status === 'pending').map((x) => one<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.users u WHERE u.status = 'active' AND u.id <> $1 AND ${inPlaces('u', '$2')}`, [x.agent_id, placeKeys(x.places)])),
    );
    let k = 0;
    res.json({ success: true, data: { posts: r.rows.map((x) => (x.status === 'pending' ? { ...x, reach: counts[k++]?.n ?? 0 } : x)) } });
  }),
);

adminRouter.post(
  '/agent-posts/:id/:decision',
  requirePerm('notify'),
  validate({
    params: z.object({ id: idParam, decision: z.enum(['approve', 'reject']) }).strict(),
    body: z.object({ note: z.string().trim().max(200).optional() }).strict(),
  }),
  ah(async (req, res) => {
    const p = await one<any>(
      `UPDATE ${S}.agent_posts SET status = CASE WHEN $2 = 'approve' THEN status ELSE 'rejected' END, decided_by = $3, decided_at = now(), note = $4
        WHERE id = $1 AND status = 'pending' RETURNING *`,
      [req.params.id, req.params.decision, req.auth!.userId, req.body.note ?? null],
    );
    if (!p) throw notFound('Request not found or already decided');
    let sent = 0;
    if (req.params.decision === 'approve') sent = await deliverAgentPost(p);
    await notifyBi(
      undefined,
      p.agent_id,
      'agent_post_decided',
      req.params.decision === 'approve' ? ['Your area announcement went out', `“${p.title}” reached ${sent} people.`] : ['Your area announcement was not approved', req.body.note || `“${p.title}”`],
      req.params.decision === 'approve' ? ['انبعت تعميمك لمنطقتك', `«${p.title}» وصل لـ ${sent} شخص.`] : ['ما انقبل طلب التعميم', req.body.note || `«${p.title}»`],
      { link: '/app/agent' },
    );
    await audit({ userId: req.auth!.userId, action: `admin.agent_post_${req.params.decision}`, entityType: 'agent_post', entityId: p.id, details: { title: p.title, sent } }, req);
    res.json({ success: true, data: { sent } });
  }),
);

/** What was sent before: announcements and messages to one person, newest first. */
adminRouter.get(
  '/broadcasts',
  requirePerm('notify'),
  ah(async (_req, res) => {
    const r = await pool.query(
      `SELECT l.id, l.action, l.details, l.created_at, l.entity_id, a.full_name AS by_name, a.email AS by_email, t.full_name AS to_name
         FROM ${S}.audit_log l
         LEFT JOIN ${S}.users a ON a.id = l.user_id
         LEFT JOIN ${S}.users t ON t.id::text = l.entity_id::text AND l.action = 'admin.user_notified'
        WHERE l.action IN ('admin.broadcast', 'admin.user_notified')
        ORDER BY l.created_at DESC LIMIT 60`,
    );
    res.json({ success: true, data: { items: r.rows } });
  }),
);

// ------------------------------------------------------------- team review
/**
 * Super admin only: how each admin is doing — support chats taken and closed, how fast
 * they answer, what customers rated them (with comments), disputes and reports settled.
 */
adminRouter.get(
  '/team',
  validate({ query: z.object({ days: z.coerce.number().int().min(1).max(3650).default(90) }).strict() }),
  ah(async (req, res) => {
    if (!isSuper(req)) throw forbidden('Only the super admin can see this', 'SUPER_ONLY');
    const days = Number(req.query.days);
    const r = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.profile_image, u.admin_level, u.admin_permissions, u.last_login_at, u.status, ${leaveJson('u.id')} AS leave,
              (SELECT count(*)::int FROM ${S}.conversations c WHERE c.assigned_to = u.id AND c.claimed_at > now() - make_interval(days => $1)) AS taken,
              (SELECT count(*)::int FROM ${S}.conversations c WHERE c.assigned_to = u.id AND c.status = 'active') AS open_now,
              (SELECT count(*)::int FROM ${S}.conversations c WHERE c.assigned_to = u.id AND c.closed_at > now() - make_interval(days => $1)) AS closed,
              (SELECT round(avg(extract(epoch FROM (c.first_reply_at - c.created_at)) / 60)::numeric, 1) FROM ${S}.conversations c
                WHERE c.assigned_to = u.id AND c.first_reply_at IS NOT NULL AND c.created_at > now() - make_interval(days => $1)) AS reply_minutes,
              (SELECT round(avg(r.stars)::numeric, 2) FROM ${S}.support_ratings r WHERE r.admin_id = u.id AND NOT r.declined AND r.updated_at > now() - make_interval(days => $1)) AS rating,
              (SELECT count(*)::int FROM ${S}.support_ratings r WHERE r.admin_id = u.id AND NOT r.declined AND r.updated_at > now() - make_interval(days => $1)) AS ratings,
              (SELECT count(*)::int FROM ${S}.support_ratings r WHERE r.admin_id = u.id AND r.declined AND r.updated_at > now() - make_interval(days => $1)) AS declined,
              (SELECT COALESCE(json_object_agg(stars, n), '{}') FROM (SELECT r.stars, count(*)::int AS n FROM ${S}.support_ratings r
                 WHERE r.admin_id = u.id AND NOT r.declined AND r.updated_at > now() - make_interval(days => $1) GROUP BY r.stars) d) AS stars,
              (SELECT count(*)::int FROM ${S}.audit_log l WHERE l.user_id = u.id AND l.action LIKE 'admin.dispute_%' AND l.created_at > now() - make_interval(days => $1)) AS disputes,
              (SELECT count(*)::int FROM ${S}.reports rp WHERE rp.assigned_to = u.id AND rp.status IN ('resolved', 'dismissed') AND rp.resolved_at > now() - make_interval(days => $1)) AS reports,
              (SELECT count(*)::int FROM ${S}.audit_log l WHERE l.user_id = u.id AND l.action LIKE 'admin.%' AND l.created_at > now() - make_interval(days => $1)) AS actions,
              (SELECT COALESCE(json_agg(x ORDER BY x.at DESC), '[]') FROM (
                 SELECT r.stars, r.comment, r.updated_at AS at, r.conversation_id, cu.full_name AS customer
                   FROM ${S}.support_ratings r LEFT JOIN ${S}.users cu ON cu.id = r.user_id
                  WHERE r.admin_id = u.id AND NOT r.declined AND r.comment IS NOT NULL ORDER BY r.updated_at DESC LIMIT 6) x) AS comments
         FROM ${S}.users u WHERE u.role = 'admin' ORDER BY (u.admin_level = 'super_admin') DESC, u.full_name`,
      [days],
    );
    res.json({ success: true, data: { admins: r.rows } });
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
        role: z.enum(['user', 'merchant', 'exchange']).default('user'),
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

/**
 * Delete an account. With money still in it, `force` (super admin or users.delete)
 * settles everything first: open orders are refunded, active vouchers returned,
 * stores closed, then whatever is left in the wallet is written off to the system
 * — every step on the ledger and in the audit log.
 */
adminRouter.delete(
  '/users/:id',
  requirePerm('users.delete'),
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ force: z.boolean().optional(), reason: z.string().trim().max(300).optional(), totp: totpCode.optional() }).strict().optional() }),
  ah(async (req, res) => {
    const t = await one<any>(`SELECT id, role, admin_level FROM ${S}.users WHERE id = $1`, [req.params.id]);
    if (!t) throw notFound('User not found');
    assertCanManage(req, t);
    const force = Boolean(req.body?.force);
    const reason = req.body?.reason ?? 'Account deleted by an administrator';
    const w = await one<any>(`SELECT balance FROM ${S}.wallets WHERE user_id = $1 AND balance <> 0 LIMIT 1`, [req.params.id]);
    if (w && !force) throw conflict('BALANCE_NOT_ZERO', 'The wallet still holds money');
    if (w && !can(req, 'users.force_delete')) throw forbidden('You do not have permission for this action', 'NO_PERMISSION');
    // Writing money off is the most serious thing an admin can do: it needs their 2-step code when they have one.
    if (w) await requireSecondFactor(req.auth!.userId, req.body?.totp);
    let writtenOff = '0.00';
    if (force) {
      const held = await pool.query(
        `SELECT o.id FROM ${S}.orders o LEFT JOIN ${S}.merchants m ON m.id = o.merchant_id
          WHERE (o.user_id = $1 OR m.user_id = $1) AND o.escrow_status = 'held'`,
        [t.id],
      );
      for (const o of held.rows) await tx((c) => refundOrder(c, o.id, 'account deleted', { actor: 'admin' }));
      const vouchers = await pool.query(`SELECT id FROM ${S}.exchange_vouchers WHERE exchange_user_id = $1 AND status = 'active'`, [t.id]);
      for (const v of vouchers.rows) await refundVoucher(v.id, 'cancelled');
      await pool.query(`UPDATE ${S}.agent_cashouts SET status = 'cancelled' WHERE agent_id = $1 AND status = 'open'`, [t.id]);
      writtenOff = await tx(async (c) => {
        const wl = await one<any>(`SELECT id, wallet_id, balance FROM ${S}.wallets WHERE user_id = $1 ORDER BY created_at LIMIT 1 FOR UPDATE`, [t.id], c);
        if (!wl || Number(wl.balance) === 0) return '0.00';
        await c.query(`UPDATE ${S}.wallets SET balance = 0, is_frozen = true WHERE id = $1`, [wl.id]);
        await writeLine(c, {
          userId: t.id,
          walletId: wl.wallet_id,
          type: 'admin_writeoff',
          amount: `-${wl.balance}`,
          description: reason,
          metadata: { by: req.auth!.userId },
          balanceAfter: '0.00',
        });
        return String(wl.balance);
      });
    }
    await pool.query(`UPDATE ${S}.merchants SET status = 'closed', updated_at = now() WHERE user_id = $1`, [t.id]);
    await pool.query(`UPDATE ${S}.agent_profiles SET status = 'suspended', updated_at = now() WHERE user_id = $1`, [t.id]);
    await anonymiseUser(req.params.id!);
    await audit({ userId: req.auth!.userId, action: 'admin.user_deleted', entityType: 'user', entityId: req.params.id, details: { force, writtenOff, reason } }, req);
    res.json({ success: true, data: { writtenOff } });
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

/** Rescue a sign-up whose code never arrived: the admin vouches for the e-mail and the account is created. */
adminRouter.post(
  '/pending-users/:id/approve',
  requirePerm('pending.manage'),
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const user = await tx(async (c) => {
      const p = await one<any>(`DELETE FROM ${S}.pending_users WHERE id = $1 RETURNING *`, [req.params.id], c);
      if (!p) throw notFound('Sign-up not found');
      if (await one(`SELECT 1 FROM ${S}.users WHERE lower(email) = lower($1)`, [p.email], c)) throw conflict('EMAIL_TAKEN', 'This e-mail already has an account');
      const role = ['merchant', 'exchange'].includes(p.role) ? p.role : 'user';
      const u = await one<any>(
        `INSERT INTO ${S}.users (email, password_hash, full_name, role, phone_number, verification_method, email_verified, email_verified_at, language, password_changed_at)
         VALUES ($1, $2, $3, $4, $5, 'admin', true, now(), $6, now()) RETURNING id, email, language`,
        [p.email, p.password_hash, p.full_name, role, p.phone_number, p.language ?? 'ar'],
        c,
      );
      await createWallet(c, u.id);
      return u;
    });
    await audit({ userId: req.auth!.userId, action: 'admin.pending_approved', entityType: 'user', entityId: user.id }, req);
    await sendMail(noticeMail(user.email, user.language === 'en' ? 'Your wallet is ready' : 'محفظتك جاهزة', user.language === 'en' ? 'Support confirmed your sign-up. You can sign in now with your e-mail and password.' : 'الدعم أكّد تسجيلك. بتقدر تدخل هلّأ بإيميلك وكلمة المرور.', user.language === 'en' ? 'en' : 'ar'));
    res.json({ success: true });
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
      `SELECT m.id, m.store_name, m.branch_name, m.parent_id, m.slug, m.logo_url, m.accent, m.city, m.description, COALESCE(m.status,'active') AS status, m.created_at,
              u.id AS owner_id, u.full_name AS owner, u.email AS owner_email,
              (SELECT count(*)::int FROM ${S}.products p WHERE p.merchant_id = m.id AND COALESCE(p.status,'active') = 'active') AS products,
              (SELECT COALESCE(SUM(total_amount),0)::text FROM ${S}.orders o WHERE o.merchant_id = m.id AND o.escrow_status = 'released') AS revenue
         FROM ${S}.merchants m LEFT JOIN ${S}.users u ON u.id = m.user_id
        ORDER BY (COALESCE(m.status,'active') = 'closed'), m.created_at DESC NULLS LAST`,
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
  validate({ query: pageQuery.extend({ action: z.string().max(64).optional(), q: z.string().trim().max(80).optional() }).strict() }),
  ah(async (req, res) => {
    const f = req.query as any;
    const params: unknown[] = [];
    const where: string[] = ['true'];
    if (f.action) {
      params.push(like(f.action));
      where.push(`l.action ILIKE $${params.length}`);
    }
    // Free search: what happened, who (e-mail or name), from which address, or anything in the details.
    if (f.q) {
      params.push(like(f.q));
      const n = params.length;
      where.push(`(l.action ILIKE $${n} OR u.email ILIKE $${n} OR u.full_name ILIKE $${n} OR l.ip_address ILIKE $${n} OR l.entity_type ILIKE $${n} OR l.details::text ILIKE $${n})`);
    }
    params.push(f.limit, f.offset);
    const r = await pool.query(
      `SELECT l.id, l.action, l.entity_type, l.entity_id, l.details, l.ip_address, l.user_agent, l.created_at, u.email, COUNT(*) OVER() AS total
         FROM ${S}.audit_log l LEFT JOIN ${S}.users u ON u.id = l.user_id
        WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
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

// ------------------------------------------------- inside merchant / agent accounts
/** Products of one store, for moderation from the user's admin page. */
adminRouter.get(
  '/stores/:id/products',
  requirePerm('stores.manage'),
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const r = await pool.query(
      `SELECT id, name, price, stock, image_url, is_digital, category, COALESCE(status,'active') AS status, created_at
         FROM ${S}.products WHERE merchant_id = $1 AND COALESCE(status,'active') <> 'deleted' ORDER BY created_at DESC LIMIT 200`,
      [req.params.id],
    );
    res.json({ success: true, data: { products: r.rows } });
  }),
);

adminRouter.patch(
  '/products/:id',
  requirePerm('stores.manage'),
  validate({
    params: z.object({ id: idParam }).strict(),
    body: z
      .object({
        status: z.enum(['active', 'hidden', 'deleted']).optional(),
        price: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/).optional(),
        stock: z.number().int().min(0).max(1_000_000).optional(),
        name: z.string().trim().min(1).max(120).optional(),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const b = req.body;
    if (b.price !== undefined && Number(b.price) <= 0) throw badRequest('INVALID_AMOUNT', 'Price must be greater than zero');
    const r = await pool.query(
      `UPDATE ${S}.products SET status = COALESCE($2, status), price = COALESCE($3::numeric, price), stock = COALESCE($4, stock), name = COALESCE($5, name), updated_at = now() WHERE id = $1`,
      [req.params.id, b.status ?? null, b.price ?? null, b.stock ?? null, b.name ?? null],
    );
    if (!r.rowCount) throw notFound('Product not found');
    await audit({ userId: req.auth!.userId, action: 'admin.product_updated', entityType: 'product', entityId: req.params.id, details: b }, req);
    res.json({ success: true });
  }),
);

/** Edit a cash agent's public profile and approve / hide it. */
adminRouter.put(
  '/users/:id/agent',
  requirePerm('users.edit'),
  validate({ params: z.object({ id: idParam }).strict(), body: agentProfileBody.extend({ status: z.enum(['active', 'pending', 'suspended']).optional() }).strict() }),
  ah(async (req, res) => {
    const target = await one<any>(`SELECT id, role, admin_level FROM ${S}.users WHERE id = $1`, [req.params.id]);
    if (!target) throw notFound('User not found');
    assertCanManage(req, target);
    if (target.role !== 'exchange') throw badRequest('NOT_AGENT', 'This account is not a cash agent');
    const { status, ...profile } = req.body;
    const before = await one<any>(`SELECT status FROM ${S}.agent_profiles WHERE user_id = $1`, [target.id]);
    await saveAgentProfile(target.id, profile, status);
    if (status === 'active' && before?.status !== 'active') {
      await notifyBi(undefined, target.id, 'agent_approved', ['You are listed', 'Customers can now find you on the cash agents map.'], ['صرت ظاهر للزبائن', 'الزبائن صاروا يشوفوك على خريطة وكلاء الصرف.'], { link: '/app/agent' });
    }
    await audit({ userId: req.auth!.userId, action: 'admin.agent_updated', entityType: 'user', entityId: target.id, details: { status } }, req);
    res.json({ success: true });
  }),
);

/** Cancel an agent's open voucher; the escrowed amount goes back to the agent. */
adminRouter.delete(
  '/vouchers/:id',
  requirePerm('users.edit'),
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const v = await refundVoucher(req.params.id!, 'cancelled');
    if (!v) throw conflict('VOUCHER_CLOSED', 'This voucher was already used or cancelled');
    await audit({ userId: req.auth!.userId, action: 'admin.voucher_cancelled', entityType: 'voucher', entityId: req.params.id }, req);
    res.json({ success: true });
  }),
);

// ------------------------------------------------------------- cash agents
/** Every cash agent with their map listing — pending ones first. */
adminRouter.get(
  '/agents',
  requirePerm('agents.manage'),
  ah(async (_req, res) => {
    const r = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.status AS account_status, u.profile_image, u.created_at,
              a.display_name, a.city, a.address, a.phone, a.hours, a.lat, a.lng, a.cash_in, a.cash_out,
              COALESCE(a.status, 'none') AS status, a.updated_at,
              (SELECT balance FROM ${S}.wallets w WHERE w.user_id = u.id ORDER BY created_at LIMIT 1) AS balance
         FROM ${S}.users u LEFT JOIN ${S}.agent_profiles a ON a.user_id = u.id
        WHERE u.role = 'exchange' AND u.email NOT LIKE 'deleted+%'
        ORDER BY CASE COALESCE(a.status,'none') WHEN 'pending' THEN 0 WHEN 'none' THEN 1 WHEN 'active' THEN 2 ELSE 3 END, a.updated_at DESC NULLS LAST`,
    );
    res.json({ success: true, data: { agents: r.rows } });
  }),
);

adminRouter.post(
  '/agents/:id/status',
  requirePerm('agents.manage'),
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ status: z.enum(['active', 'pending', 'suspended']) }).strict() }),
  ah(async (req, res) => {
    const r = await pool.query(`UPDATE ${S}.agent_profiles SET status = $2, updated_at = now() WHERE user_id = $1 RETURNING user_id`, [req.params.id, req.body.status]);
    if (!r.rowCount) throw notFound('User not found');
    if (req.body.status === 'active') {
      await notifyBi(undefined, req.params.id!, 'agent_approved', ['You are listed', 'Customers can now find you on the cash agents map.'], ['صرت ظاهر للزبائن', 'الزبائن صاروا يشوفوك على خريطة وكلاء الصرف.'], { link: '/app/agent' });
    }
    await audit({ userId: req.auth!.userId, action: 'admin.agent_status', entityType: 'user', entityId: req.params.id, details: req.body }, req);
    res.json({ success: true });
  }),
);

// ------------------------------------------------------- full store control
adminRouter.get(
  '/stores/:id',
  requirePerm('stores.manage'),
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const store = await one<any>(
      `SELECT m.*, u.full_name AS owner, u.email AS owner_email, u.id AS owner_id FROM ${S}.merchants m LEFT JOIN ${S}.users u ON u.id = m.user_id WHERE m.id = $1`,
      [req.params.id],
    );
    if (!store) throw notFound('Store not found');
    const mainId = store.parent_id ?? store.id;
    const branches = await pool.query(
      `SELECT id, store_name, branch_name, city, address, slug, COALESCE(status,'active') AS status, parent_id,
              (SELECT count(*)::int FROM ${S}.products p WHERE p.merchant_id = m.id AND COALESCE(p.status,'active') <> 'deleted') AS products
         FROM ${S}.merchants m WHERE id = $1 OR parent_id = $1 ORDER BY parent_id NULLS FIRST, created_at`,
      [mainId],
    );
    const products = await pool.query(
      `SELECT id, merchant_id, name, price, stock, image_url, is_digital, category, COALESCE(status,'active') AS status, created_at
         FROM ${S}.products WHERE merchant_id = $1 AND COALESCE(status,'active') <> 'deleted' ORDER BY created_at DESC LIMIT 300`,
      [store.id],
    );
    const orders = await pool.query(
      `SELECT o.id, o.total_amount, o.status, o.escrow_status, o.dispute_status, o.created_at, u.full_name AS buyer
         FROM ${S}.orders o LEFT JOIN ${S}.users u ON u.id = o.user_id WHERE o.merchant_id = $1 ORDER BY o.created_at DESC LIMIT 50`,
      [store.id],
    );
    const ads = await pool.query(`SELECT id, kind, media_url, title, active FROM ${S}.store_ads WHERE merchant_id = $1 ORDER BY created_at DESC`, [store.id]);
    const pickup = await pool.query(`SELECT id, name, city, active FROM ${S}.pickup_points WHERE merchant_id = $1 ORDER BY sort`, [store.id]);
    const stats = await one<any>(
      `SELECT COALESCE(SUM(total_amount) FILTER (WHERE escrow_status = 'released'),0)::text AS revenue,
              COALESCE(SUM(COALESCE(amount_paid,total_amount)) FILTER (WHERE escrow_status = 'held'),0)::text AS in_escrow,
              count(*)::int AS orders
         FROM ${S}.orders WHERE merchant_id = $1`,
      [store.id],
    );
    res.json({ success: true, data: { store, branches: branches.rows, products: products.rows, orders: orders.rows, ads: ads.rows, pickupPoints: pickup.rows, stats } });
  }),
);

adminRouter.put(
  '/stores/:id',
  requirePerm('stores.manage'),
  validate({
    params: z.object({ id: idParam }).strict(),
    body: z
      .object({
        storeName: z.string().trim().min(2).max(60),
        branchName: z.string().trim().max(60).nullable().optional(),
        description: z.string().trim().max(500).nullable().optional(),
        category: z.string().trim().max(30).nullable().optional(),
        city: z.string().trim().max(60).nullable().optional(),
        address: z.string().trim().max(200).nullable().optional(),
        phone: z.string().trim().max(20).nullable().optional(),
        showPhone: z.boolean().optional(),
        offersPickup: z.boolean().optional(),
        offersDelivery: z.boolean().optional(),
        status: z.enum(['active', 'suspended', 'closed']).optional(),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const b = req.body;
    const r = await pool.query(
      `UPDATE ${S}.merchants SET store_name = $2, branch_name = COALESCE($3, branch_name), description = $4, category = COALESCE($5, category), city = $6, address = $7,
              phone = $8, show_phone = COALESCE($9, show_phone), offers_pickup = COALESCE($10, offers_pickup), offers_delivery = COALESCE($11, offers_delivery),
              status = COALESCE($12, status), updated_at = now()
        WHERE id = $1`,
      [req.params.id, b.storeName, b.branchName ?? null, b.description ?? null, b.category ?? null, b.city ?? null, b.address ?? null, b.phone ?? null,
        b.showPhone ?? null, b.offersPickup ?? null, b.offersDelivery ?? null, b.status ?? null],
    );
    if (!r.rowCount) throw notFound('Store not found');
    await audit({ userId: req.auth!.userId, action: 'admin.store_updated', entityType: 'store', entityId: req.params.id, details: b }, req);
    res.json({ success: true });
  }),
);

/** Delete a store (and its branches) for good: open orders are refunded first. */
adminRouter.delete(
  '/stores/:id',
  requirePerm('stores.delete'),
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const m = await one<any>(`SELECT id, user_id, store_name FROM ${S}.merchants WHERE id = $1`, [req.params.id]);
    if (!m) throw notFound('Store not found');
    const ids = (await pool.query(`SELECT id FROM ${S}.merchants WHERE id = $1 OR parent_id = $1`, [m.id])).rows.map((x) => x.id);
    const held = await pool.query(`SELECT id FROM ${S}.orders WHERE merchant_id = ANY($1) AND escrow_status = 'held'`, [ids]);
    for (const o of held.rows) await tx((c) => refundOrder(c, o.id, 'store removed by support', { actor: 'admin' }));
    await pool.query(`UPDATE ${S}.products SET status = 'deleted', updated_at = now() WHERE merchant_id = ANY($1)`, [ids]);
    await pool.query(`DELETE FROM ${S}.store_ads WHERE merchant_id = ANY($1)`, [ids]);
    await pool.query(`DELETE FROM ${S}.pickup_points WHERE merchant_id = ANY($1)`, [ids]);
    await pool.query(`UPDATE ${S}.merchants SET status = 'closed', updated_at = now() WHERE id = ANY($1)`, [ids]);
    if (m.user_id)
      await notifyBi(undefined, m.user_id, 'store_removed', ['Store removed', `Support removed ${m.store_name}. Open orders were refunded.`], ['انشال المتجر', `الدعم شال متجر ${m.store_name}. الطلبات المفتوحة رجعت مصاريها.`]);
    await audit({ userId: req.auth!.userId, action: 'admin.store_deleted', entityType: 'store', entityId: m.id, details: { refunded: held.rowCount } }, req);
    res.json({ success: true, data: { refunded: held.rowCount } });
  }),
);

adminRouter.delete(
  '/ads/:id',
  requirePerm('stores.manage'),
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    await pool.query(`DELETE FROM ${S}.store_ads WHERE id = $1`, [req.params.id]);
    await audit({ userId: req.auth!.userId, action: 'admin.ad_deleted', entityType: 'ad', entityId: req.params.id }, req);
    res.json({ success: true });
  }),
);

// ----------------------------------------------------------- device history
/**
 * Every device the person ever signed in from (once each): whether it is signed in now,
 * every network address it used with how often, the approximate place of each address,
 * its recent sign-ins, and a few signals worth a second look.
 */
adminRouter.get(
  '/users/:id/devices',
  requirePerm('users.devices'),
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const r = await pool.query(
      `SELECT d.id, d.user_agent, d.first_ip, d.last_ip, d.ips, d.sign_ins, d.first_seen, d.last_seen,
              (SELECT count(DISTINCT t.family_id)::int FROM ${S}.refresh_tokens t
                WHERE t.user_id = d.user_id AND md5(COALESCE(t.user_agent, '')) = d.device_key
                  AND t.revoked_at IS NULL AND t.expires_at > now() AND t.family_expires_at > now()) AS active_sessions
         FROM ${S}.user_devices d WHERE d.user_id = $1 ORDER BY d.last_seen DESC LIMIT 100`,
      [req.params.id],
    );
    // Fill places not looked up yet (a few per view; the rest fill in on the next).
    const missing = await pool.query(
      `SELECT DISTINCT p.ip FROM ${S}.user_device_places p LEFT JOIN ${S}.ip_geo g ON g.ip = p.ip
        WHERE p.user_id = $1 AND g.ip IS NULL LIMIT 8`,
      [req.params.id],
    );
    await Promise.allSettled(missing.rows.map((x) => placeOf(x.ip)));
    const places = await pool.query(
      `SELECT p.device_id, p.ip, p.hits, p.first_seen, p.last_seen,
              g.city, g.region, g.country, g.country_code, g.lat, g.lng, g.isp, g.org, g.timezone
         FROM ${S}.user_device_places p LEFT JOIN ${S}.ip_geo g ON g.ip = p.ip AND g.ok
        WHERE p.user_id = $1 ORDER BY p.last_seen DESC`,
      [req.params.id],
    );
    const signins = await pool.query(
      `SELECT * FROM (SELECT s.device_id, s.ip, s.at, g.city, g.country, row_number() OVER (PARTITION BY s.device_id ORDER BY s.at DESC) AS n
                        FROM ${S}.user_signins s LEFT JOIN ${S}.ip_geo g ON g.ip = s.ip AND g.ok WHERE s.user_id = $1) x
        WHERE n <= 15 ORDER BY at DESC`,
      [req.params.id],
    );
    const by = <T extends { device_id: string }>(rows: T[], id: string) => rows.filter((x) => String(x.device_id) === String(id));
    const all = places.rows;
    const countries = [...new Set(all.map((x) => x.country_code).filter(Boolean))];
    const cities = [...new Set(all.map((x) => x.city).filter(Boolean))];
    const recent = await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.user_signins WHERE user_id = $1 AND at > now() - interval '24 hours'`, [req.params.id]);
    res.json({
      success: true,
      data: {
        devices: r.rows.map((d) => ({ ...d, places: by(all, d.id), signins: by(signins.rows, d.id) })),
        summary: {
          devices: r.rows.length,
          live: r.rows.filter((d) => d.active_sessions > 0).length,
          addresses: new Set(all.map((x) => x.ip)).size,
          cities,
          countries,
          signins24h: recent?.n ?? 0,
          foreign: countries.filter((c) => c !== 'PS' && c !== 'IL').length > 0,
        },
      },
    });
  }),
);

/** Sign the person out of one device only (every live session from it), effective immediately. */
adminRouter.post(
  '/users/:id/devices/:deviceId/sign-out',
  requirePerm('users.security'),
  validate({ params: z.object({ id: idParam, deviceId: idParam }).strict() }),
  ah(async (req, res) => {
    const t = await one<any>(`SELECT id, role, admin_level FROM ${S}.users WHERE id = $1`, [req.params.id]);
    if (!t) throw notFound('User not found');
    assertCanManage(req, t);
    const d = await one<any>(`SELECT device_key, user_agent FROM ${S}.user_devices WHERE id = $1 AND user_id = $2`, [req.params.deviceId, t.id]);
    if (!d) throw notFound('Device not found');
    const r = await pool.query(
      `UPDATE ${S}.refresh_tokens SET revoked_at = now()
        WHERE user_id = $1 AND md5(COALESCE(user_agent, '')) = $2 AND revoked_at IS NULL RETURNING family_id`,
      [t.id, d.device_key],
    );
    for (const f of new Set(r.rows.map((x) => String(x.family_id)))) revokeSessionNow(f);
    await notifyBi(undefined, t.id, 'activity:auth_device_out', ['Signed out of a device', 'Support signed your account out of one device. If that wasn’t expected, change your password.'], ['انطلعت من جهاز', 'الدعم طلّع حسابك من جهاز واحد. إذا مش متوقع، غيّر كلمة المرور.']);
    await audit({ userId: req.auth!.userId, action: 'admin.device_signed_out', entityType: 'user', entityId: t.id, details: { device: d.user_agent?.slice(0, 160), sessions: r.rowCount } }, req);
    res.json({ success: true, data: { sessions: new Set(r.rows.map((x) => x.family_id)).size } });
  }),
);

// ------------------------------------------------------ suggested categories
/** Category suggestions from store owners, newest first, with how many stores use each. */
adminRouter.get(
  '/categories',
  requirePerm('stores.manage'),
  ah(async (_req, res) => {
    const r = await pool.query(
      `SELECT c.slug, c.name_ar, c.name_en, c.status, c.reason, c.created_at, c.reviewed_at,
              m.store_name, m.slug AS store_slug, u.full_name AS owner_name,
              (SELECT count(*)::int FROM ${S}.merchants x WHERE x.category = c.slug AND COALESCE(x.status,'active') <> 'closed') AS stores
         FROM ${S}.store_categories c
         LEFT JOIN ${S}.merchants m ON m.id = c.merchant_id
         LEFT JOIN ${S}.users u ON u.id = c.requested_by
        ORDER BY (c.status = 'pending') DESC, c.created_at DESC LIMIT 200`,
    );
    res.json({ success: true, data: { categories: r.rows } });
  }),
);

const catSlug = z.object({ slug: z.string().regex(/^c_[a-f0-9]{6}$/) }).strict();

/** Approve a suggestion (names can be tidied first): it joins the list and the store that asked moves into it. */
adminRouter.post(
  '/categories/:slug/approve',
  requirePerm('stores.manage'),
  validate({ params: catSlug, body: z.object({ nameAr: z.string().trim().min(2).max(30), nameEn: z.string().trim().min(2).max(30) }).strict() }),
  ah(async (req, res) => {
    const c = await one<any>(
      `UPDATE ${S}.store_categories SET status = 'approved', name_ar = $2, name_en = $3, reason = NULL, reviewed_by = $4, reviewed_at = now()
        WHERE slug = $1 RETURNING slug, merchant_id, requested_by`,
      [req.params.slug, req.body.nameAr, req.body.nameEn, req.auth!.userId],
    );
    if (!c) throw notFound('Category not found');
    if (c.merchant_id) await pool.query(`UPDATE ${S}.merchants SET category = $2, updated_at = now() WHERE id = $1 AND category = 'other'`, [c.merchant_id, c.slug]);
    if (c.requested_by)
      await notifyBi(undefined, c.requested_by, 'store:category', ['Category approved', `“${req.body.nameEn}” is now a category, and your store is in it.`], ['انقبل التصنيف', `«${req.body.nameAr}» صار تصنيف، ومتجرك صار فيه.`]);
    await audit({ userId: req.auth!.userId, action: 'admin.category_approved', entityType: 'category', entityId: c.slug, details: { nameAr: req.body.nameAr, nameEn: req.body.nameEn } }, req);
    res.json({ success: true });
  }),
);

/** Turn a suggestion down (or withdraw an approved category: its stores go back to "Other"). */
adminRouter.post(
  '/categories/:slug/reject',
  requirePerm('stores.manage'),
  validate({ params: catSlug, body: z.object({ reason: z.string().trim().max(200).optional() }).strict() }),
  ah(async (req, res) => {
    const c = await one<any>(
      `UPDATE ${S}.store_categories SET status = 'rejected', reason = $2, reviewed_by = $3, reviewed_at = now()
        WHERE slug = $1 RETURNING slug, name_ar, name_en, requested_by`,
      [req.params.slug, req.body.reason || null, req.auth!.userId],
    );
    if (!c) throw notFound('Category not found');
    await pool.query(`UPDATE ${S}.merchants SET category = 'other', updated_at = now() WHERE category = $1`, [c.slug]);
    if (c.requested_by)
      await notifyBi(
        undefined,
        c.requested_by,
        'store:category',
        ['Category not added', `“${c.name_en}” wasn’t added${req.body.reason ? `: ${req.body.reason}` : '.'} Your store stays under “Other”.`],
        ['ما انضاف التصنيف', `«${c.name_ar}» ما انضاف${req.body.reason ? `: ${req.body.reason}` : '.'} متجرك بضل تحت «غير ذلك».`],
      );
    await audit({ userId: req.auth!.userId, action: 'admin.category_rejected', entityType: 'category', entityId: c.slug, details: { reason: req.body.reason } }, req);
    res.json({ success: true });
  }),
);

// ------------------------------------------------------------------ daily transfer limits
const LIMIT = z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, 'Enter a limit like 5000 or 7500.50');

/** Limits by account type, and every person's limit (own or by type) with what they used today. */
adminRouter.get(
  '/limits',
  requirePerm('limits.manage'),
  validate({
    query: pageQuery.extend({ q: z.string().trim().max(64).optional(), type: z.enum(LIMIT_TYPES).optional(), only: z.enum(['custom']).optional() }).strict(),
  }),
  ah(async (req, res) => {
    const q = req.query as any;
    const t = await one<any>(`SELECT limit_user::text AS user, limit_merchant::text AS merchant, limit_exchange::text AS exchange FROM ${S}.system_settings WHERE id = 1`);
    const types = { user: t?.user ?? null, merchant: t?.merchant ?? null, exchange: t?.exchange ?? null } as Record<string, string | null>;
    const counts = await one<any>(
      `SELECT count(*) FILTER (WHERE role = 'user')::int AS user, count(*) FILTER (WHERE role = 'merchant')::int AS merchant,
              count(*) FILTER (WHERE role = 'exchange')::int AS exchange, count(*) FILTER (WHERE daily_limit IS NOT NULL)::int AS custom
         FROM ${S}.users WHERE role IN ('user','merchant','exchange') AND status <> 'deleted'`,
    );
    const params: unknown[] = [];
    const where = [`u.role IN ('user','merchant','exchange')`, `u.status <> 'deleted'`];
    if (q.q) {
      params.push(like(q.q));
      const n = params.length;
      where.push(`(u.full_name ILIKE $${n} OR u.email ILIKE $${n} OR u.phone_number ILIKE $${n} OR EXISTS (SELECT 1 FROM ${S}.merchants m WHERE m.user_id = u.id AND m.store_name ILIKE $${n}))`);
    }
    if (q.type) {
      params.push(q.type);
      where.push(`u.role = $${params.length}`);
    }
    if (q.only === 'custom') where.push(`u.daily_limit IS NOT NULL`);
    params.push(q.limit, q.offset);
    const r = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.role, u.profile_image, u.status,
              (SELECT m.store_name FROM ${S}.merchants m WHERE m.user_id = u.id ORDER BY m.created_at LIMIT 1) AS store_name,
              u.daily_limit::text AS custom_limit, u.daily_limit_note AS note, u.daily_limit_at AS set_at, b.full_name AS set_by,
              (SELECT COALESCE(-SUM(t.amount), 0)::text FROM ${S}.transactions t JOIN ${S}.wallets w ON w.wallet_id = t.wallet_id
                WHERE w.user_id = u.id AND t.amount < 0 AND t.status IN ('completed','pending')
                  AND t.transaction_type IN ('transfer_out','deposit','purchase','payment','cash_out')
                  AND t.created_at >= date_trunc('day', now())) AS used_today,
              COUNT(*) OVER() AS total
         FROM ${S}.users u LEFT JOIN ${S}.users b ON b.id = u.daily_limit_by
        WHERE ${where.join(' AND ')}
        ORDER BY (u.daily_limit IS NOT NULL) DESC, u.daily_limit_at DESC NULLS LAST, u.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({
      success: true,
      data: {
        global: env.DAILY_TRANSFER_LIMIT,
        types,
        counts,
        people: r.rows.map(({ total, ...u }) => ({ ...u, effective: u.custom_limit ?? types[u.role] ?? env.DAILY_TRANSFER_LIMIT })),
        total: Number(r.rows[0]?.total ?? 0),
      },
    });
  }),
);

/** Change the limit of an account type (empty = the app-wide limit). */
adminRouter.put(
  '/limits/types',
  requirePerm('limits.manage'),
  validate({ body: z.object({ type: z.enum(LIMIT_TYPES), limit: LIMIT.nullable() }).strict() }),
  ah(async (req, res) => {
    await pool.query(
      `INSERT INTO ${S}.system_settings (id, site_name, currency, theme) VALUES (1, 'S-Taler', $1, 'emerald') ON CONFLICT (id) DO NOTHING`,
      [env.CURRENCY],
    );
    await pool.query(`UPDATE ${S}.system_settings SET limit_${req.body.type as (typeof LIMIT_TYPES)[number]} = $1, updated_at = now() WHERE id = 1`, [req.body.limit]);
    await audit({ userId: req.auth!.userId, action: 'admin.limit_type', details: req.body }, req);
    res.json({ success: true });
  }),
);

/** Give one person their own daily limit (higher or lower than their type's), or remove it. They're told. */
adminRouter.put(
  '/users/:id/limit',
  requirePerm('limits.manage'),
  validate({ params: z.object({ id: z.string().uuid() }).strict(), body: z.object({ limit: LIMIT.nullable(), note: z.string().trim().max(200).nullable().optional() }).strict() }),
  ah(async (req, res) => {
    const u = await one<any>(`SELECT id, role, status, daily_limit::text AS old FROM ${S}.users WHERE id = $1`, [req.params.id]);
    if (!u || !['user', 'merchant', 'exchange'].includes(u.role) || u.status === 'deleted') throw notFound('Account not found');
    const limit: string | null = req.body.limit;
    await pool.query(`UPDATE ${S}.users SET daily_limit = $2, daily_limit_note = $3, daily_limit_by = $4, daily_limit_at = now() WHERE id = $1`, [
      u.id,
      limit,
      limit === null ? null : (req.body.note ?? null),
      req.auth!.userId,
    ]);
    await audit({ userId: req.auth!.userId, action: 'admin.limit_user', entityType: 'user', entityId: u.id, details: { from: u.old, to: limit, note: req.body.note ?? null } }, req);
    const now = limit ?? (await dailyLimitFor(u.id));
    await notifyBi(undefined, u.id, 'limit_changed', ['Your daily transfer limit changed', `It is now ${now} ${env.CURRENCY} a day.`], ['تغيّر سقف تحويلك اليومي', `صار ${now} ${env.CURRENCY} باليوم.`], {
      link: '/app/settings',
    });
    res.json({ success: true, data: { effective: now } });
  }),
);

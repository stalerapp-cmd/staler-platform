import { Router, type Request } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { env } from '../config/env.js';
import { one, pool, S, tx } from '../lib/db.js';
import { codeHash, decrypt, encrypt, numericCode } from '../lib/crypto.js';
import { AppError, badRequest, conflict, forbidden, notFound, tooMany, unauthorized } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { signToken, verifyToken } from '../lib/jwt.js';
import { codeMail, noticeMail, sendMail } from '../lib/mailer.js';
import { verifyGoogleCredential } from '../lib/google.js';
import { checkSmsCode, sendSmsCode, smsEnabled } from '../lib/sms.js';
import { hashPassword, needsRehash, passwordSchema, verifyPassword } from '../lib/passwords.js';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../lib/totp.js';
import { email, fullName, otpCode, totpCode, username, validate, uuid } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { cmp } from '../lib/money.js';
import { generateAccountNumber, generateIban } from '../lib/iban.js';
import { paytoFor } from '../db/bootstrap.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter, codeLimiter, registerLimiter } from '../middleware/security.js';
import { centralAccount, move, notify } from './ledger.js';
import { checkSecondFactor, newRecoveryCodes, requireSecondFactor, totpIssuer } from './mfa.js';
import {
  clearRefreshCookie,
  issueSession,
  presentedRefreshToken,
  revokeAllSessions,
  revokeFamilyByToken,
  rotate,
} from './sessions.js';

export const authRouter = Router();

const CODE_TTL_MIN = 15;
const MAX_CODE_ATTEMPTS = 5;
const MAX_LOGIN_FAILURES = 5;
const lang = z.enum(['en', 'ar']).default('en');

export async function publicUser(userId: string) {
  return one(
    `SELECT u.id, u.full_name, u.email, u.username, u.role, u.admin_level, u.admin_permissions, u.status, u.language, u.phone, u.email_verified,
            u.totp_enabled, u.created_at, u.last_login_at,
            COALESCE(cardinality(u.totp_recovery_hashes), 0) AS recovery_codes_left
       FROM ${S}.users u WHERE u.id = $1`,
    [userId],
  );
}

/** Creates the customer, their first account (valid IBAN) and pays the optional sign-up bonus. */
async function createCustomer(p: { full_name: string; email: string; username: string; password_hash: string; language: string; phone?: string | null }) {
  return tx(async (c) => {
    const user = await one<{ id: string; role: string; token_version: number }>(
      `INSERT INTO ${S}.users (full_name, email, username, password_hash, role, status, email_verified, language, password_changed_at, phone)
       VALUES ($1, $2, $3, $4, 'user', 'active', true, $5, now(), $6) RETURNING id, role, token_version`,
      [p.full_name, p.email, p.username, p.password_hash, p.language, p.phone ?? null],
      c,
    );
    const iban = generateIban();
    const acc = await one<{ id: string }>(
      `INSERT INTO ${S}.bank_accounts (user_id, account_number, iban, currency, balance, payto_uri, nickname)
       VALUES ($1, $2, $3, $4, 0, $5, 'Main account') RETURNING id`,
      [user!.id, generateAccountNumber(), iban, env.CURRENCY, paytoFor(iban, p.full_name)],
      c,
    );
    if (cmp(env.SIGNUP_BONUS, '0') > 0) {
      const central = await centralAccount(c).catch(() => null);
      if (central) {
        await move(c, {
          fromAccountId: central.id,
          toAccountId: acc!.id,
          amount: env.SIGNUP_BONUS,
          type: 'deposit',
          subject: 'Welcome bonus',
          allowLockedSource: true,
        });
        await notify(c, user!.id, 'welcome', 'Welcome to ' + env.BANK_NAME, `A welcome bonus of ${env.SIGNUP_BONUS} ${env.CURRENCY} was credited.`);
      }
    }
    return user!;
  });
}

// ------------------------------------------------------------------ register
authRouter.post(
  '/register',
  registerLimiter,
  validate({
    body: z
      .object({
        fullName,
        email,
        username,
        password: passwordSchema,
        language: lang,
        phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/).optional(),
        method: z.enum(['email', 'sms']).default('email'),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const { fullName: name, email: mail, username: uname, password, language, phone, method } = req.body;
    if (method === 'sms' && (!phone || !smsEnabled())) throw badRequest('SMS_DISABLED', 'SMS codes are not available — use e-mail');
    const setting = await one<{ value: unknown }>(`SELECT value FROM ${S}.settings WHERE key = 'allow_registrations'`);
    if (setting && setting.value === false) throw forbidden('Registrations are currently closed', 'REGISTRATION_CLOSED');
    if (password.toLowerCase().includes(uname) || password.toLowerCase().includes(mail.split('@')[0]!)) {
      throw badRequest('WEAK_PASSWORD', 'Password must not contain your username or e-mail');
    }

    const taken = await one(`SELECT 1 FROM ${S}.users WHERE lower(email) = $1`, [mail]);
    const generic = { success: true, message: 'If this e-mail can be registered, a verification code has been sent.' };
    if (taken) {
      // Don't reveal whether the e-mail exists; tell the real owner instead.
      await sendMail(noticeMail(mail, 'Registration attempt', 'Someone tried to open an account with your e-mail. If it was you, simply sign in.', language));
      return res.status(201).json(generic);
    }
    const unameTaken = await one(
      `SELECT 1 FROM ${S}.users WHERE username = $1 UNION ALL SELECT 1 FROM ${S}.pending_users WHERE username = $1 AND lower(email) <> $2`,
      [uname, mail],
    );
    if (unameTaken) throw conflict('USERNAME_TAKEN', 'This username is already taken');

    const code = numericCode(6);
    await pool.query(
      `INSERT INTO ${S}.pending_users (full_name, email, username, password_hash, role, verification_code, code_expires_at, expires_at, attempts, language, phone, verification_method)
       VALUES ($1, $2, $3, $4, 'user', $5, now() + interval '${CODE_TTL_MIN} minutes', now() + interval '24 hours', 0, $6, $7, $8)
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, username = EXCLUDED.username,
         password_hash = EXCLUDED.password_hash, verification_code = EXCLUDED.verification_code,
         code_expires_at = EXCLUDED.code_expires_at, expires_at = EXCLUDED.expires_at, attempts = 0, language = EXCLUDED.language,
         phone = EXCLUDED.phone, verification_method = EXCLUDED.verification_method`,
      [name, mail, uname, await hashPassword(password), codeHash('verify', mail, code), language, phone ?? null, method],
    );
    if (method === 'sms') await sendSmsCode(phone!, language);
    else await sendMail(codeMail(mail, 'verify', code, language));
    res.status(201).json(generic);
  }),
);

authRouter.post(
  '/verify-email',
  codeLimiter,
  validate({ body: z.object({ email, code: otpCode }).strict() }),
  ah(async (req, res) => {
    const { email: mail, code } = req.body;
    const p = await one<any>(`SELECT * FROM ${S}.pending_users WHERE lower(email) = $1`, [mail]);
    if (!p) throw badRequest('INVALID_CODE', 'Invalid or expired code');
    if (p.attempts >= MAX_CODE_ATTEMPTS) throw tooMany('Too many wrong codes. Request a new one.', 'CODE_LOCKED');
    const codeOk =
      p.verification_method === 'sms' && p.phone
        ? await checkSmsCode(p.phone, code)
        : new Date(p.code_expires_at) >= new Date() && p.verification_code === codeHash('verify', mail, code);
    if (!codeOk) {
      await pool.query(`UPDATE ${S}.pending_users SET attempts = attempts + 1 WHERE id = $1`, [p.id]);
      throw badRequest('INVALID_CODE', 'Invalid or expired code');
    }
    const del = await pool.query(`DELETE FROM ${S}.pending_users WHERE id = $1 RETURNING id`, [p.id]);
    if (del.rowCount === 0) throw badRequest('INVALID_CODE', 'Invalid or expired code'); // concurrent double-submit
    const user = await createCustomer({
      full_name: p.full_name,
      email: mail,
      username: p.username ?? mail.split('@')[0]!.replace(/[^a-z0-9_]/g, '').slice(0, 24) + numericCode(3),
      password_hash: p.password_hash,
      language: p.language ?? 'en',
      phone: p.phone ?? null,
    });
    await audit({ userId: user.id, action: 'auth.registered' }, req);
    const session = await issueSession(req, res, user);
    res.status(201).json({ success: true, data: { ...session, user: await publicUser(user.id) } });
  }),
);

authRouter.post(
  '/resend-code',
  codeLimiter,
  validate({ body: z.object({ email }).strict() }),
  ah(async (req, res) => {
    const p = await one<any>(`SELECT id, language, phone, verification_method FROM ${S}.pending_users WHERE lower(email) = $1 AND expires_at > now()`, [req.body.email]);
    if (p) {
      const code = numericCode(6);
      await pool.query(
        `UPDATE ${S}.pending_users SET verification_code = $2, code_expires_at = now() + interval '${CODE_TTL_MIN} minutes', attempts = 0 WHERE id = $1`,
        [p.id, codeHash('verify', req.body.email, code)],
      );
      if (p.verification_method === 'sms' && p.phone && smsEnabled()) await sendSmsCode(p.phone, p.language ?? 'ar');
      else await sendMail(codeMail(req.body.email, 'verify', code, p.language ?? 'en'));
    }
    res.json({ success: true, message: 'If a registration is pending, a new code has been sent.' });
  }),
);

// ------------------------------------------------------- Continue with Google
authRouter.post(
  '/google',
  authLimiter,
  validate({ body: z.object({ credential: z.string().min(100).max(4096), language: lang.optional() }).strict() }),
  ah(async (req, res) => {
    const g = await verifyGoogleCredential(req.body.credential);
    let u = await one<any>(`SELECT id, role, status, totp_enabled, token_version FROM ${S}.users WHERE lower(email) = $1`, [g.email]);
    if (!u) {
      const setting = await one<{ value: unknown }>(`SELECT value FROM ${S}.settings WHERE key = 'allow_registrations'`);
      if (setting && setting.value === false) throw forbidden('Registrations are currently closed', 'REGISTRATION_CLOSED');
      await pool.query(`DELETE FROM ${S}.pending_users WHERE lower(email) = $1`, [g.email]);
      const base = g.email.split('@')[0]!.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20) || 'client';
      const created = await createCustomer({
        full_name: g.name,
        email: g.email,
        username: `${base}${numericCode(4)}`,
        password_hash: await hashPassword(numericCode(12) + numericCode(12)), // unusable until reset
        language: req.body.language ?? 'ar',
      });
      await audit({ userId: created.id, action: 'auth.registered', details: { via: 'google' } }, req);
      u = { ...created, status: 'active', totp_enabled: false };
    }
    if (u.status !== 'active') throw forbidden('This account is suspended', 'ACCOUNT_SUSPENDED');
    if (u.totp_enabled) {
      const mfaToken = await signToken({ sub: u.id, role: u.role, tv: u.token_version, sid: 'mfa', typ: 'mfa' }, 300);
      return res.json({ success: true, data: { mfaRequired: true, mfaToken } });
    }
    await audit({ userId: u.id, action: 'auth.login_google' }, req);
    res.json({ success: true, data: await completeLogin(req, res, u.id) });
  }),
);

// --------------------------------------------------------------------- login
export async function recordFailure(userId: string) {
  await pool.query(
    `UPDATE ${S}.users SET failed_login_count = failed_login_count + 1,
       locked_until = CASE WHEN failed_login_count + 1 >= ${MAX_LOGIN_FAILURES}
         THEN now() + LEAST(interval '24 hours', interval '15 minutes' * power(2, failed_login_count + 1 - ${MAX_LOGIN_FAILURES}))
         ELSE locked_until END
     WHERE id = $1`,
    [userId],
  );
}

async function completeLogin(req: Request, res: any, userId: string) {
  const u = await one<any>(
    `UPDATE ${S}.users SET failed_login_count = 0, locked_until = NULL, last_login_at = now()
      WHERE id = $1 RETURNING id, role, token_version`,
    [userId],
  );
  await audit({ userId, action: 'auth.login' }, req);
  const session = await issueSession(req, res, u);
  return { ...session, user: await publicUser(userId) };
}

authRouter.post(
  '/login',
  authLimiter,
  validate({ body: z.object({ login: z.string().trim().toLowerCase().min(3).max(254), password: z.string().min(1).max(256) }).strict() }),
  ah(async (req, res) => {
    const { login, password } = req.body;
    const u = await one<any>(
      `SELECT id, role, status, password_hash, locked_until, totp_enabled, token_version
         FROM ${S}.users WHERE lower(email) = $1 OR username = $1 LIMIT 1`,
      [login],
    );
    if (u?.locked_until && new Date(u.locked_until) > new Date()) {
      throw new AppError(423, 'ACCOUNT_TEMPORARILY_LOCKED', 'Too many failed attempts. Try again later or reset your password.');
    }
    const ok = await verifyPassword(password, u?.password_hash);
    if (!u || !ok || u.role === 'exchange') {
      if (u) {
        await recordFailure(u.id);
        await audit({ userId: u.id, action: 'auth.login_failed' }, req);
      }
      throw unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');
    }
    if (u.status !== 'active') throw forbidden('This account is suspended', 'ACCOUNT_SUSPENDED');
    if (needsRehash(u.password_hash)) {
      await pool.query(`UPDATE ${S}.users SET password_hash = $2 WHERE id = $1`, [u.id, await hashPassword(password)]);
    }
    if (u.totp_enabled) {
      const mfaToken = await signToken({ sub: u.id, role: u.role, tv: u.token_version, sid: 'mfa', typ: 'mfa' }, 300);
      return res.json({ success: true, data: { mfaRequired: true, mfaToken } });
    }
    res.json({ success: true, data: await completeLogin(req, res, u.id) });
  }),
);

authRouter.post(
  '/login/mfa',
  authLimiter,
  validate({ body: z.object({ mfaToken: z.string().min(20).max(2048), code: totpCode }).strict() }),
  ah(async (req, res) => {
    let claims;
    try {
      claims = await verifyToken(req.body.mfaToken, 'mfa');
    } catch {
      throw unauthorized('Sign-in step expired, start again', 'MFA_EXPIRED');
    }
    const u = await one<any>(`SELECT id, status, token_version, locked_until FROM ${S}.users WHERE id = $1`, [claims.sub]);
    if (!u || u.token_version !== claims.tv) throw unauthorized('Sign-in step expired, start again', 'MFA_EXPIRED');
    if (u.locked_until && new Date(u.locked_until) > new Date()) {
      throw new AppError(423, 'ACCOUNT_TEMPORARILY_LOCKED', 'Too many failed attempts. Try again later.');
    }
    if (!(await checkSecondFactor(u.id, req.body.code))) {
      await recordFailure(u.id);
      throw unauthorized('Authenticator code is incorrect', 'MFA_INVALID');
    }
    if (u.status !== 'active') throw forbidden('This account is suspended', 'ACCOUNT_SUSPENDED');
    res.json({ success: true, data: await completeLogin(req, res, u.id) });
  }),
);

// ------------------------------------------------------------------ sessions
authRouter.post(
  '/refresh',
  ah(async (req, res) => {
    // Cookie mode: require a custom header — browsers can't send it cross-site without CORS approval.
    if (!req.headers['x-client'] && req.headers['x-requested-with'] !== 'fetch') {
      throw forbidden('Missing anti-CSRF header', 'CSRF');
    }
    const presented = presentedRefreshToken(req);
    // No session at all is a normal state for a visitor, not an error.
    if (!presented) return res.status(204).end();
    const { session, userId } = await rotate(req, res, presented);
    res.json({ success: true, data: { ...session, user: await publicUser(userId) } });
  }),
);

authRouter.post(
  '/logout',
  ah(async (req, res) => {
    const presented = presentedRefreshToken(req);
    if (presented) await revokeFamilyByToken(presented);
    clearRefreshCookie(res);
    res.json({ success: true });
  }),
);

authRouter.post(
  '/logout-all',
  requireAuth,
  ah(async (req, res) => {
    await revokeAllSessions(req.auth!.userId);
    await audit({ userId: req.auth!.userId, action: 'auth.logout_all' }, req);
    clearRefreshCookie(res);
    res.json({ success: true });
  }),
);

// ------------------------------------------------------------ password reset
authRouter.post(
  '/forgot-password',
  codeLimiter,
  validate({ body: z.object({ email }).strict() }),
  ah(async (req, res) => {
    const u = await one<any>(`SELECT id, language, role FROM ${S}.users WHERE lower(email) = $1 AND status = 'active'`, [req.body.email]);
    if (u && u.role !== 'exchange') {
      const code = numericCode(6);
      await pool.query(`UPDATE ${S}.verification_codes SET used = true WHERE lower(email) = $1 AND type = 'reset_password' AND used = false`, [req.body.email]);
      await pool.query(
        `INSERT INTO ${S}.verification_codes (email, code, type, expires_at, user_id) VALUES ($1, $2, 'reset_password', now() + interval '${CODE_TTL_MIN} minutes', $3)`,
        [req.body.email, codeHash('reset', req.body.email, code), u.id],
      );
      await sendMail(codeMail(req.body.email, 'reset', code, u.language ?? 'en'));
    }
    if (!u) {
      // Never finished signing up? Send the sign-up code again and send them to the code page.
      const p = await one<any>(`SELECT id, language FROM ${S}.pending_users WHERE lower(email) = $1 AND (expires_at IS NULL OR expires_at > now())`, [req.body.email]);
      if (p) {
        const code = numericCode(6);
        await pool.query(
          `UPDATE ${S}.pending_users SET verification_code = $2, code_expires_at = now() + interval '${CODE_TTL_MIN} minutes', attempts = 0, verification_method = 'email' WHERE id = $1`,
          [p.id, codeHash('verify', req.body.email, code)],
        );
        await sendMail(codeMail(req.body.email, 'verify', code, p.language ?? 'ar'));
        return res.json({ success: true, data: { pending: true }, message: 'Your sign-up was never confirmed — we sent the sign-up code again.' });
      }
    }
    res.json({ success: true, message: 'If the e-mail is registered, a reset code has been sent.' });
  }),
);

authRouter.post(
  '/reset-password',
  codeLimiter,
  validate({ body: z.object({ email, code: otpCode, newPassword: passwordSchema }).strict() }),
  ah(async (req, res) => {
    const { email: mail, code, newPassword } = req.body;
    const v = await one<any>(
      `SELECT id, code, attempts, expires_at, user_id FROM ${S}.verification_codes
        WHERE lower(email) = $1 AND type = 'reset_password' AND used = false ORDER BY created_at DESC LIMIT 1`,
      [mail],
    );
    if (!v || v.attempts >= MAX_CODE_ATTEMPTS || new Date(v.expires_at) < new Date() || v.code !== codeHash('reset', mail, code)) {
      if (v) await pool.query(`UPDATE ${S}.verification_codes SET attempts = attempts + 1 WHERE id = $1`, [v.id]);
      throw badRequest('INVALID_CODE', 'Invalid or expired code');
    }
    const used = await pool.query(`UPDATE ${S}.verification_codes SET used = true WHERE id = $1 AND used = false`, [v.id]);
    if (used.rowCount === 0) throw badRequest('INVALID_CODE', 'Invalid or expired code');
    await pool.query(
      `UPDATE ${S}.users SET password_hash = $2, password_changed_at = now(), failed_login_count = 0, locked_until = NULL
        WHERE id = $1`,
      [v.user_id, await hashPassword(newPassword)],
    );
    await revokeAllSessions(v.user_id);
    await audit({ userId: v.user_id, action: 'auth.password_reset' }, req);
    await sendMail(noticeMail(mail, 'Password changed', 'Your password was reset and all devices were signed out.'));
    res.json({ success: true, message: 'Password updated. Please sign in.' });
  }),
);

// ------------------------------------------------------------------- profile
authRouter.get(
  '/me',
  requireAuth,
  ah(async (req, res) => {
    const user = await publicUser(req.auth!.userId);
    if (!user) throw notFound();
    res.json({ success: true, data: { user } });
  }),
);

authRouter.patch(
  '/me',
  requireAuth,
  validate({
    body: z
      .object({
        fullName: fullName.optional(),
        language: z.enum(['en', 'ar']).optional(),
        phone: z.string().trim().regex(/^\+?[0-9 ]{7,20}$/, 'Invalid phone number').optional().nullable(),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const { fullName: name, language, phone } = req.body;
    await pool.query(
      `UPDATE ${S}.users SET full_name = COALESCE($2, full_name), language = COALESCE($3, language),
              phone = CASE WHEN $5 THEN $4 ELSE phone END WHERE id = $1`,
      [req.auth!.userId, name ?? null, language ?? null, phone ?? null, phone !== undefined],
    );
    res.json({ success: true, data: { user: await publicUser(req.auth!.userId) } });
  }),
);

authRouter.post(
  '/me/password',
  requireAuth,
  validate({ body: z.object({ currentPassword: z.string().min(1).max(256), newPassword: passwordSchema }).strict() }),
  ah(async (req, res) => {
    const u = await one<any>(`SELECT id, role, email, password_hash FROM ${S}.users WHERE id = $1`, [req.auth!.userId]);
    if (!u || !(await verifyPassword(req.body.currentPassword, u.password_hash))) {
      throw badRequest('WRONG_PASSWORD', 'Current password is incorrect');
    }
    if (req.body.currentPassword === req.body.newPassword) throw badRequest('SAME_PASSWORD', 'Choose a different password');
    await pool.query(`UPDATE ${S}.users SET password_hash = $2, password_changed_at = now() WHERE id = $1`, [u.id, await hashPassword(req.body.newPassword)]);
    await revokeAllSessions(u.id);
    await audit({ userId: u.id, action: 'auth.password_changed' }, req);
    await sendMail(noticeMail(u.email, 'Password changed', 'Your password was changed and other devices were signed out.'));
    const fresh = await one<any>(`SELECT id, role, token_version FROM ${S}.users WHERE id = $1`, [u.id]);
    const session = await issueSession(req, res, fresh);
    res.json({ success: true, data: session });
  }),
);

authRouter.get(
  '/me/sessions',
  requireAuth,
  ah(async (req, res) => {
    const r = await pool.query(
      `SELECT DISTINCT ON (family_id) family_id AS id, user_agent, ip_address, created_at, last_used_at, expires_at
         FROM ${S}.refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY family_id, created_at DESC`,
      [req.auth!.userId],
    );
    res.json({
      success: true,
      data: { sessions: r.rows.map((s) => ({ ...s, current: s.id === req.auth!.sid })) },
    });
  }),
);

authRouter.delete(
  '/me/sessions/:id',
  requireAuth,
  validate({ params: z.object({ id: uuid }).strict() }),
  ah(async (req, res) => {
    await pool.query(
      `UPDATE ${S}.refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE family_id = $1 AND user_id = $2`,
      [req.params.id, req.auth!.userId],
    );
    res.json({ success: true });
  }),
);

// ----------------------------------------------------------------------- 2FA
authRouter.post(
  '/me/totp/setup',
  requireAuth,
  ah(async (req, res) => {
    const u = await one<any>(`SELECT email, totp_enabled FROM ${S}.users WHERE id = $1`, [req.auth!.userId]);
    if (u.totp_enabled) throw conflict('TOTP_ALREADY_ENABLED', 'Two-factor authentication is already enabled');
    const secret = generateTotpSecret();
    await pool.query(`UPDATE ${S}.users SET totp_secret_enc = $2 WHERE id = $1`, [req.auth!.userId, encrypt(secret, `totp:${req.auth!.userId}`)]);
    const url = otpauthUrl(secret, u.email, totpIssuer());
    res.json({ success: true, data: { secret, otpauthUrl: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 240 }) } });
  }),
);

authRouter.post(
  '/me/totp/enable',
  requireAuth,
  validate({ body: z.object({ code: otpCode }).strict() }),
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    const u = await one<any>(`SELECT totp_secret_enc, totp_enabled FROM ${S}.users WHERE id = $1`, [userId]);
    if (!u?.totp_secret_enc) throw badRequest('TOTP_NOT_SETUP', 'Start the setup first');
    if (u.totp_enabled) throw conflict('TOTP_ALREADY_ENABLED', 'Already enabled');
    const step = verifyTotp(decrypt(u.totp_secret_enc, `totp:${userId}`), req.body.code);
    if (step === null) throw badRequest('MFA_INVALID', 'Code is incorrect — check your phone clock');
    const { codes, hashes } = newRecoveryCodes(userId);
    await pool.query(
      `UPDATE ${S}.users SET totp_enabled = true, totp_last_step = $2, totp_recovery_hashes = $3 WHERE id = $1`,
      [userId, step, hashes],
    );
    await audit({ userId, action: 'auth.totp_enabled' }, req);
    res.json({ success: true, data: { recoveryCodes: codes } });
  }),
);

authRouter.post(
  '/me/totp/disable',
  requireAuth,
  validate({ body: z.object({ password: z.string().min(1).max(256), code: totpCode }).strict() }),
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    const u = await one<any>(`SELECT password_hash FROM ${S}.users WHERE id = $1`, [userId]);
    if (!(await verifyPassword(req.body.password, u?.password_hash))) throw badRequest('WRONG_PASSWORD', 'Password is incorrect');
    await requireSecondFactor(userId, req.body.code);
    await pool.query(
      `UPDATE ${S}.users SET totp_enabled = false, totp_secret_enc = NULL, totp_last_step = NULL, totp_recovery_hashes = '{}' WHERE id = $1`,
      [userId],
    );
    await audit({ userId, action: 'auth.totp_disabled' }, req);
    res.json({ success: true });
  }),
);

authRouter.post(
  '/me/close',
  requireAuth,
  validate({ body: z.object({ password: z.string().min(1).max(256), code: totpCode.optional() }).strict() }),
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    if (req.auth!.role !== 'user') throw forbidden('System accounts cannot be closed');
    const u = await one<any>(`SELECT password_hash FROM ${S}.users WHERE id = $1`, [userId]);
    if (!(await verifyPassword(req.body.password, u?.password_hash))) throw badRequest('WRONG_PASSWORD', 'Password is incorrect');
    await requireSecondFactor(userId, req.body.code);
    const bal = await one<{ nonzero: string }>(
      `SELECT count(*)::text AS nonzero FROM ${S}.bank_accounts WHERE user_id = $1 AND balance <> 0`,
      [userId],
    );
    if (bal && bal.nonzero !== '0') throw conflict('BALANCE_NOT_ZERO', 'Move all money out of your accounts before closing');
    await pool.query(`UPDATE ${S}.bank_accounts SET is_locked = true WHERE user_id = $1`, [userId]);
    await pool.query(`UPDATE ${S}.api_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
    await pool.query(`UPDATE ${S}.users SET status = 'suspended' WHERE id = $1`, [userId]);
    await revokeAllSessions(userId);
    await audit({ userId, action: 'auth.account_closed' }, req);
    clearRefreshCookie(res);
    res.json({ success: true });
  }),
);

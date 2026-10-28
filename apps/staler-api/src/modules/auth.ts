import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import QRCode from 'qrcode';
import { z } from 'zod';
import { env } from '../config/env.js';
import { one, pool, S, tx } from '../lib/db.js';
import { codeHash, decrypt, encrypt, numericCode, randomToken } from '../lib/crypto.js';
import { AppError, badRequest, conflict, forbidden, notFound, tooMany, unauthorized } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { signToken, verifyToken } from '../lib/jwt.js';
import { codeMail, noticeMail, sendMail } from '../lib/mailer.js';
import { verifyGoogleCredential } from '../lib/google.js';
import { checkSmsCode, sendSmsCode, smsEnabled } from '../lib/sms.js';
import { hashPassword, needsRehash, passwordSchema, verifyPassword } from '../lib/passwords.js';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../lib/totp.js';
import { email, fullName, otpCode, totpCode, uuid, validate } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { putFile } from '../lib/storage.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter, codeLimiter, registerLimiter } from '../middleware/security.js';
import { checkSecondFactor, newRecoveryCodes, requireSecondFactor, totpIssuer } from './mfa.js';
import { clearRefreshCookie, issueSession, presentedRefreshToken, revokeAllSessions, revokeFamilyByToken, rotate } from './sessions.js';
import { createWallet } from './walletCore.js';

export const authRouter = Router();

const CODE_TTL_MIN = 15;
const MAX_CODE_ATTEMPTS = 5;
const MAX_LOGIN_FAILURES = 5;
const lang = z.enum(['en', 'ar']).default('en');
const phone = z.string().trim().regex(/^\+?[0-9 ]{7,20}$/, 'Invalid phone number');

export async function publicUser(userId: string) {
  return one(
    `SELECT u.id, u.email, u.full_name, u.role, u.admin_level, u.admin_permissions, u.profile_image, u.phone_number, u.language,
            u.totp_enabled, u.email_verified, u.created_at, u.last_login_at,
            COALESCE(cardinality(u.totp_recovery_hashes), 0) AS recovery_codes_left,
            w.wallet_id, w.balance, w.currency, w.is_frozen AS wallet_frozen,
            m.id AS merchant_id, m.store_name
       FROM ${S}.users u
       LEFT JOIN LATERAL (SELECT wallet_id, balance, currency, is_frozen FROM ${S}.wallets WHERE user_id = u.id ORDER BY created_at ASC NULLS LAST LIMIT 1) w ON true
       LEFT JOIN LATERAL (SELECT id, store_name FROM ${S}.merchants WHERE user_id = u.id ORDER BY created_at ASC NULLS LAST LIMIT 1) m ON true
      WHERE u.id = $1`,
    [userId],
  );
}

async function settings() {
  return (await one<any>(`SELECT allow_registrations, maintenance_mode FROM ${S}.system_settings WHERE id = 1`)) ?? {
    allow_registrations: true,
    maintenance_mode: false,
  };
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
        password: passwordSchema,
        accountType: z.enum(['user', 'merchant']).default('user'),
        phoneNumber: phone.optional(),
        language: lang,
        /** Where the 6-digit code goes: e-mail (default) or SMS to phoneNumber. */
        method: z.enum(['email', 'sms']).default('email'),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const { fullName: name, email: mail, password, accountType, phoneNumber, language, method } = req.body;
    if (method === 'sms' && (!phoneNumber || !smsEnabled())) throw badRequest('SMS_DISABLED', 'SMS codes are not available — use e-mail');
    if (!(await settings()).allow_registrations) throw forbidden('Registrations are currently closed', 'REGISTRATION_CLOSED');
    if (password.toLowerCase().includes(mail.split('@')[0]!)) throw badRequest('WEAK_PASSWORD', 'Password must not contain your e-mail');
    const generic = { success: true, message: 'If this e-mail can be registered, a verification code has been sent.' };
    if (await one(`SELECT 1 FROM ${S}.users WHERE lower(email) = $1`, [mail])) {
      await sendMail(noticeMail(mail, 'Registration attempt', 'Someone tried to create a wallet with your e-mail. If it was you, just sign in.', language));
      return res.status(201).json(generic);
    }
    const code = numericCode(6);
    await pool.query(
      `INSERT INTO ${S}.pending_users (email, password_hash, full_name, role, phone_number, verification_method, verification_code,
                                       code_expires_at, expires_at, attempts, language)
       VALUES ($1, $2, $3, $4, $5, $8, $6, now() + interval '${CODE_TTL_MIN} minutes', now() + interval '24 hours', 0, $7)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name, role = EXCLUDED.role,
         phone_number = EXCLUDED.phone_number, verification_code = EXCLUDED.verification_code, code_expires_at = EXCLUDED.code_expires_at,
         expires_at = EXCLUDED.expires_at, attempts = 0, language = EXCLUDED.language, verification_method = EXCLUDED.verification_method`,
      [mail, await hashPassword(password), name, accountType, phoneNumber ?? null, codeHash('verify', mail, code), language, method],
    );
    if (method === 'sms') await sendSmsCode(phoneNumber!, language);
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
      p.verification_method === 'sms' && p.phone_number
        ? await checkSmsCode(p.phone_number, code)
        : Boolean(p.code_expires_at) && new Date(p.code_expires_at) >= new Date() && p.verification_code === codeHash('verify', mail, code);
    if (!codeOk) {
      await pool.query(`UPDATE ${S}.pending_users SET attempts = attempts + 1 WHERE id = $1`, [p.id]);
      throw badRequest('INVALID_CODE', 'Invalid or expired code');
    }
    // Only self-service roles may come out of a pending registration — never admin/exchange.
    const role = p.role === 'merchant' ? 'merchant' : 'user';
    const user = await tx(async (c) => {
      const del = await c.query(`DELETE FROM ${S}.pending_users WHERE id = $1 RETURNING id`, [p.id]);
      if (del.rowCount === 0) throw badRequest('INVALID_CODE', 'Invalid or expired code');
      const u = await one<any>(
        `INSERT INTO ${S}.users (email, password_hash, full_name, role, phone_number, verification_method, email_verified,
                                 email_verified_at, language, password_changed_at)
         VALUES ($1, $2, $3, $4, $5, 'email', true, now(), $6, now()) RETURNING id, role, token_version`,
        [mail, p.password_hash, p.full_name, role, p.phone_number, p.language ?? 'en'],
        c,
      );
      await createWallet(c, u.id);
      return u;
    });
    await audit({ userId: user.id, action: 'auth.registered', details: { role } }, req);
    const session = await issueSession(req, res, user);
    res.status(201).json({ success: true, data: { ...session, user: await publicUser(user.id) } });
  }),
);

authRouter.post(
  '/resend-code',
  codeLimiter,
  validate({ body: z.object({ email }).strict() }),
  ah(async (req, res) => {
    const p = await one<any>(`SELECT id, language, verification_method, phone_number FROM ${S}.pending_users WHERE lower(email) = $1 AND (expires_at IS NULL OR expires_at > now())`, [
      req.body.email,
    ]);
    if (p) {
      const code = numericCode(6);
      await pool.query(
        `UPDATE ${S}.pending_users SET verification_code = $2, code_expires_at = now() + interval '${CODE_TTL_MIN} minutes', attempts = 0 WHERE id = $1`,
        [p.id, codeHash('verify', req.body.email, code)],
      );
      if (p.verification_method === 'sms' && p.phone_number && smsEnabled()) await sendSmsCode(p.phone_number, p.language ?? 'ar');
      else await sendMail(codeMail(req.body.email, 'verify', code, p.language ?? 'en'));
    }
    res.json({ success: true, message: 'If a registration is pending, a new code has been sent.' });
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

async function completeLogin(req: Request, res: Response, userId: string) {
  const u = await one<any>(
    `UPDATE ${S}.users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1 RETURNING id, role, token_version`,
    [userId],
  );
  await audit({ userId, action: 'auth.login' }, req);
  const session = await issueSession(req, res, u);
  return { ...session, user: await publicUser(userId) };
}

// ------------------------------------------------------- Continue with Google
authRouter.post(
  '/google',
  authLimiter,
  validate({
    body: z.object({ credential: z.string().min(100).max(4096), accountType: z.enum(['user', 'merchant']).optional(), language: lang.optional() }).strict(),
  }),
  ah(async (req, res) => {
    const g = await verifyGoogleCredential(req.body.credential);
    let u = await one<any>(`SELECT id, role, status, totp_enabled, token_version FROM ${S}.users WHERE lower(email) = $1`, [g.email]);
    if (!u) {
      if (!(await settings()).allow_registrations) throw forbidden('Registrations are currently closed', 'REGISTRATION_CLOSED');
      const role = req.body.accountType === 'merchant' ? 'merchant' : 'user';
      // Google already proved the e-mail; the password is random and unusable until the person sets one ("Forgot password").
      u = await tx(async (c) => {
        await c.query(`DELETE FROM ${S}.pending_users WHERE lower(email) = $1`, [g.email]);
        const nu = await one<any>(
          `INSERT INTO ${S}.users (email, password_hash, full_name, role, verification_method, email_verified, email_verified_at, language, password_changed_at)
           VALUES ($1, $2, $3, $4, 'google', true, now(), $5, now()) RETURNING id, role, status, totp_enabled, token_version`,
          [g.email, await hashPassword(randomToken(32)), g.name, role, req.body.language ?? 'ar'],
          c,
        );
        await createWallet(c, nu.id);
        return nu;
      });
      await audit({ userId: u.id, action: 'auth.registered', details: { role, via: 'google' } }, req);
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

authRouter.post(
  '/login',
  authLimiter,
  validate({ body: z.object({ email, password: z.string().min(1).max(256) }).strict() }),
  ah(async (req, res) => {
    const { email: mail, password } = req.body;
    const u = await one<any>(`SELECT id, role, status, password_hash, locked_until, totp_enabled, token_version FROM ${S}.users WHERE lower(email) = $1`, [
      mail,
    ]);
    if (u?.locked_until && new Date(u.locked_until) > new Date()) {
      throw new AppError(423, 'ACCOUNT_TEMPORARILY_LOCKED', 'Too many failed attempts. Try again later or reset your password.');
    }
    const ok = await verifyPassword(password, u?.password_hash);
    if (!u || !ok) {
      if (u) {
        await recordFailure(u.id);
        await audit({ userId: u.id, action: 'auth.login_failed' }, req);
      } else {
        // Registration still pending? Tell the user (only with the right password, so nothing leaks).
        const p = await one<any>(`SELECT password_hash FROM ${S}.pending_users WHERE lower(email) = $1 AND (expires_at IS NULL OR expires_at > now())`, [mail]);
        if (p && (await verifyPassword(password, p.password_hash))) {
          throw new AppError(403, 'PENDING_VERIFICATION', 'Please verify your e-mail first — check your inbox or request a new code.');
        }
      }
      throw unauthorized('Invalid e-mail or password', 'INVALID_CREDENTIALS');
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
    if (u.locked_until && new Date(u.locked_until) > new Date()) throw new AppError(423, 'ACCOUNT_TEMPORARILY_LOCKED', 'Too many failed attempts.');
    if (!(await checkSecondFactor(u.id, req.body.code))) {
      await recordFailure(u.id);
      throw unauthorized('Authenticator code is incorrect', 'MFA_INVALID');
    }
    if (u.status !== 'active') throw forbidden('This account is suspended', 'ACCOUNT_SUSPENDED');
    res.json({ success: true, data: await completeLogin(req, res, u.id) });
  }),
);

authRouter.post(
  '/refresh',
  ah(async (req, res) => {
    if (!req.headers['x-client'] && req.headers['x-requested-with'] !== 'fetch') throw forbidden('Missing anti-CSRF header', 'CSRF');
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
    const u = await one<any>(`SELECT id, language FROM ${S}.users WHERE lower(email) = $1 AND status = 'active'`, [req.body.email]);
    if (u) {
      const code = numericCode(6);
      await pool.query(`UPDATE ${S}.password_resets SET used = true WHERE user_id = $1 AND used = false`, [u.id]);
      await pool.query(
        `INSERT INTO ${S}.password_resets (user_id, email, reset_code, used, expires_at) VALUES ($1, $2, $3, false, now() + interval '${CODE_TTL_MIN} minutes')`,
        [u.id, req.body.email, codeHash('reset', req.body.email, code)],
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
      `SELECT r.id, r.reset_code, r.attempts, r.expires_at, r.user_id FROM ${S}.password_resets r JOIN ${S}.users u ON u.id = r.user_id
        WHERE lower(u.email) = $1 AND r.used = false ORDER BY r.created_at DESC LIMIT 1`,
      [mail],
    );
    if (!v || v.attempts >= MAX_CODE_ATTEMPTS || new Date(v.expires_at) < new Date() || v.reset_code !== codeHash('reset', mail, code)) {
      if (v) await pool.query(`UPDATE ${S}.password_resets SET attempts = attempts + 1 WHERE id = $1`, [v.id]);
      throw badRequest('INVALID_CODE', 'Invalid or expired code');
    }
    const used = await pool.query(`UPDATE ${S}.password_resets SET used = true WHERE id = $1 AND used = false`, [v.id]);
    if (used.rowCount === 0) throw badRequest('INVALID_CODE', 'Invalid or expired code');
    await pool.query(`UPDATE ${S}.users SET password_hash = $2, password_changed_at = now(), failed_login_count = 0, locked_until = NULL WHERE id = $1`, [
      v.user_id,
      await hashPassword(newPassword),
    ]);
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
  validate({ body: z.object({ fullName: fullName.optional(), language: z.enum(['en', 'ar']).optional(), phoneNumber: phone.nullable().optional() }).strict() }),
  ah(async (req, res) => {
    const { fullName: name, language, phoneNumber } = req.body;
    await pool.query(
      `UPDATE ${S}.users SET full_name = COALESCE($2, full_name), language = COALESCE($3, language),
              phone_number = CASE WHEN $5 THEN $4 ELSE phone_number END WHERE id = $1`,
      [req.auth!.userId, name ?? null, language ?? null, phoneNumber ?? null, phoneNumber !== undefined],
    );
    res.json({ success: true, data: { user: await publicUser(req.auth!.userId) } });
  }),
);

/** E-mail change: the code goes to the NEW address (proves ownership); the old one is notified. */
authRouter.post(
  '/me/email',
  requireAuth,
  codeLimiter,
  validate({ body: z.object({ newEmail: email, password: z.string().min(1).max(256) }).strict() }),
  ah(async (req, res) => {
    const u = await one<any>(`SELECT email, password_hash, language FROM ${S}.users WHERE id = $1`, [req.auth!.userId]);
    if (!(await verifyPassword(req.body.password, u.password_hash))) throw badRequest('WRONG_PASSWORD', 'Password is incorrect');
    if (req.body.newEmail === u.email.toLowerCase()) throw badRequest('SAME_EMAIL', 'This is already your e-mail');
    if (await one(`SELECT 1 FROM ${S}.users WHERE lower(email) = $1`, [req.body.newEmail])) throw conflict('EMAIL_TAKEN', 'This e-mail is already in use');
    const code = numericCode(6);
    await pool.query(`UPDATE ${S}.profile_update_verifications SET verified = true WHERE user_id = $1 AND verified = false`, [req.auth!.userId]);
    await pool.query(
      `INSERT INTO ${S}.profile_update_verifications (user_id, verification_code, update_type, new_value, pending_changes, expires_at, verified)
       VALUES ($1, $2, 'email', $3, '{}', now() + interval '${CODE_TTL_MIN} minutes', false)`,
      [req.auth!.userId, codeHash('email-change', req.body.newEmail, code), req.body.newEmail],
    );
    await sendMail(codeMail(req.body.newEmail, 'verify', code, u.language ?? 'en'));
    res.json({ success: true, message: 'A code was sent to the new e-mail address.' });
  }),
);

authRouter.post(
  '/me/email/confirm',
  requireAuth,
  codeLimiter,
  validate({ body: z.object({ code: otpCode }).strict() }),
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    const v = await one<any>(
      `SELECT id, verification_code, new_value, attempts, expires_at FROM ${S}.profile_update_verifications
        WHERE user_id = $1 AND verified = false AND update_type = 'email' ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    if (!v || v.attempts >= MAX_CODE_ATTEMPTS || new Date(v.expires_at) < new Date() || v.verification_code !== codeHash('email-change', v.new_value, req.body.code)) {
      if (v) await pool.query(`UPDATE ${S}.profile_update_verifications SET attempts = attempts + 1 WHERE id = $1`, [v.id]);
      throw badRequest('INVALID_CODE', 'Invalid or expired code');
    }
    const old = await one<any>(`SELECT email FROM ${S}.users WHERE id = $1`, [userId]);
    await pool.query(`UPDATE ${S}.profile_update_verifications SET verified = true WHERE id = $1`, [v.id]);
    await pool.query(`UPDATE ${S}.users SET email = $2, email_verified = true, email_verified_at = now() WHERE id = $1`, [userId, v.new_value]);
    await sendMail(noticeMail(old.email, 'E-mail changed', `Your account e-mail was changed to ${v.new_value}. If this was not you, contact support immediately.`));
    await audit({ userId, action: 'auth.email_changed' }, req);
    res.json({ success: true, data: { user: await publicUser(userId) } });
  }),
);

authRouter.post(
  '/me/password',
  requireAuth,
  validate({ body: z.object({ currentPassword: z.string().min(1).max(256), newPassword: passwordSchema }).strict() }),
  ah(async (req, res) => {
    const u = await one<any>(`SELECT id, email, password_hash FROM ${S}.users WHERE id = $1`, [req.auth!.userId]);
    if (!(await verifyPassword(req.body.currentPassword, u?.password_hash))) throw badRequest('WRONG_PASSWORD', 'Current password is incorrect');
    if (req.body.currentPassword === req.body.newPassword) throw badRequest('SAME_PASSWORD', 'Choose a different password');
    await pool.query(`UPDATE ${S}.users SET password_hash = $2, password_changed_at = now() WHERE id = $1`, [u.id, await hashPassword(req.body.newPassword)]);
    await revokeAllSessions(u.id);
    await audit({ userId: u.id, action: 'auth.password_changed' }, req);
    await sendMail(noticeMail(u.email, 'Password changed', 'Your password was changed and other devices were signed out.'));
    const fresh = await one<any>(`SELECT id, role, token_version FROM ${S}.users WHERE id = $1`, [u.id]);
    res.json({ success: true, data: await issueSession(req, res, fresh) });
  }),
);

const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 } });

authRouter.post(
  '/me/avatar',
  requireAuth,
  avatarUpload.single('image'),
  ah(async (req, res) => {
    if (!req.file) throw badRequest('NO_FILE', 'Choose an image');
    const type = await fileTypeFromBuffer(req.file.buffer);
    if (!type || !['image/jpeg', 'image/png', 'image/webp'].includes(type.mime)) throw badRequest('INVALID_IMAGE', 'Only JPEG, PNG or WebP images are allowed');
    const stored = await putFile('avatars', req.auth!.userId, type.ext, type.mime, req.file.buffer, req.file.originalname);
    await pool.query(`UPDATE ${S}.users SET profile_image = $2 WHERE id = $1`, [req.auth!.userId, stored.url]);
    res.json({ success: true, data: { profileImage: stored.url } });
  }),
);

authRouter.delete(
  '/me/avatar',
  requireAuth,
  ah(async (req, res) => {
    await pool.query(`UPDATE ${S}.users SET profile_image = NULL WHERE id = $1`, [req.auth!.userId]);
    res.json({ success: true });
  }),
);

authRouter.get(
  '/me/sessions',
  requireAuth,
  ah(async (req, res) => {
    const r = await pool.query(
      `SELECT DISTINCT ON (family_id) family_id AS id, user_agent, ip_address, created_at, last_used_at, expires_at
         FROM ${S}.refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY family_id, created_at DESC`,
      [req.auth!.userId],
    );
    res.json({ success: true, data: { sessions: r.rows.map((s) => ({ ...s, current: s.id === req.auth!.sid })) } });
  }),
);

authRouter.delete(
  '/me/sessions/:id',
  requireAuth,
  validate({ params: z.object({ id: uuid }).strict() }),
  ah(async (req, res) => {
    await pool.query(`UPDATE ${S}.refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE family_id = $1 AND user_id = $2`, [
      req.params.id,
      req.auth!.userId,
    ]);
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
    await pool.query(`UPDATE ${S}.users SET totp_enabled = true, totp_last_step = $2, totp_recovery_hashes = $3 WHERE id = $1`, [userId, step, hashes]);
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

// ---------------------------------------------------------- account deletion
/** Anonymises the person but keeps financial records intact (they are needed for audits). */
export async function anonymiseUser(userId: string) {
  await pool.query(
    `UPDATE ${S}.users SET status = 'suspended', email = 'deleted+' || id::text || '@deleted.invalid', full_name = 'Deleted user',
            phone_number = NULL, profile_image = NULL, password_hash = '!', totp_enabled = false, totp_secret_enc = NULL,
            totp_recovery_hashes = '{}' WHERE id = $1`,
    [userId],
  );
  await pool.query(`UPDATE ${S}.bank_accounts SET status = 'inactive', bank_token_enc = NULL WHERE user_id = $1`, [userId]);
  await revokeAllSessions(userId);
}

authRouter.post(
  '/me/delete/request',
  requireAuth,
  codeLimiter,
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    if (req.auth!.role === 'admin' && req.auth!.adminLevel === 'super_admin') throw forbidden('A super admin account cannot be deleted');
    const u = await one<any>(
      `SELECT u.email, u.language, w.balance FROM ${S}.users u LEFT JOIN ${S}.wallets w ON w.user_id = u.id WHERE u.id = $1 ORDER BY w.created_at LIMIT 1`,
      [userId],
    );
    if (u.balance && Number(u.balance) !== 0) throw conflict('BALANCE_NOT_ZERO', 'Move your remaining balance out before deleting your account');
    const open = await one<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${S}.orders o LEFT JOIN ${S}.merchants m ON m.id = o.merchant_id
        WHERE (o.user_id = $1 OR m.user_id = $1) AND o.status IN ('pending','processing','shipped')`,
      [userId],
    );
    if (open && open.n !== '0') throw conflict('OPEN_ORDERS', 'Finish or cancel your open orders first');
    const code = numericCode(6);
    await pool.query(`UPDATE ${S}.account_deletion_requests SET confirmed = true WHERE user_id = $1 AND confirmed = false`, [userId]);
    await pool.query(
      `INSERT INTO ${S}.account_deletion_requests (user_id, deletion_code, expires_at, confirmed) VALUES ($1, $2, now() + interval '${CODE_TTL_MIN} minutes', false)`,
      [userId, codeHash('delete', String(userId), code)],
    );
    await sendMail(codeMail(u.email, 'security', code, u.language ?? 'en'));
    res.json({ success: true, message: 'A confirmation code was sent to your e-mail.' });
  }),
);

authRouter.post(
  '/me/delete/confirm',
  requireAuth,
  codeLimiter,
  validate({ body: z.object({ code: otpCode, password: z.string().min(1).max(256) }).strict() }),
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    const u = await one<any>(`SELECT password_hash FROM ${S}.users WHERE id = $1`, [userId]);
    if (!(await verifyPassword(req.body.password, u?.password_hash))) throw badRequest('WRONG_PASSWORD', 'Password is incorrect');
    const r = await one<any>(
      `SELECT id, deletion_code, attempts, expires_at FROM ${S}.account_deletion_requests WHERE user_id = $1 AND confirmed = false ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    if (!r || r.attempts >= MAX_CODE_ATTEMPTS || new Date(r.expires_at) < new Date() || r.deletion_code !== codeHash('delete', String(userId), req.body.code)) {
      if (r) await pool.query(`UPDATE ${S}.account_deletion_requests SET attempts = attempts + 1 WHERE id = $1`, [r.id]);
      throw badRequest('INVALID_CODE', 'Invalid or expired code');
    }
    const w = await one<any>(`SELECT balance FROM ${S}.wallets WHERE user_id = $1 AND balance <> 0 LIMIT 1`, [userId]);
    if (w) throw conflict('BALANCE_NOT_ZERO', 'Move your remaining balance out before deleting your account');
    await pool.query(`UPDATE ${S}.account_deletion_requests SET confirmed = true WHERE id = $1`, [r.id]);
    await anonymiseUser(userId);
    await audit({ userId, action: 'auth.account_deleted' }, req);
    clearRefreshCookie(res);
    res.json({ success: true });
  }),
);

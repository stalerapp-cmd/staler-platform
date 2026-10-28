import type pg from 'pg';
import { env } from '../config/env.js';
import { one, pool, S } from '../lib/db.js';
import { decrypt, hmac, readableCode } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { verifyTotp } from '../lib/totp.js';

/**
 * Checks a second factor for a user: either a 6-digit TOTP (each time-step
 * accepted once — replay safe) or a single-use recovery code (XXXX-XXXX).
 * Returns true when the user has no 2FA enabled at all.
 */
export async function checkSecondFactor(userId: string, code: string | undefined, client: pg.Pool | pg.PoolClient = pool): Promise<boolean> {
  const u = await one<{ totp_enabled: boolean; totp_secret_enc: string | null; totp_last_step: string | null; totp_recovery_hashes: string[] }>(
    `SELECT totp_enabled, totp_secret_enc, totp_last_step, totp_recovery_hashes FROM ${S}.users WHERE id = $1`,
    [userId],
    client,
  );
  if (!u || !u.totp_enabled || !u.totp_secret_enc) return true;
  if (!code) return false;
  const normalized = code.trim().toUpperCase();
  if (/^\d{6}$/.test(normalized)) {
    const secret = decrypt(u.totp_secret_enc, `totp:${userId}`);
    const step = verifyTotp(secret, normalized);
    if (step === null) return false;
    // Atomic replay protection: only succeeds if this step is newer than the last accepted one.
    const r = await client.query(
      `UPDATE ${S}.users SET totp_last_step = $2 WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)`,
      [userId, step],
    );
    return r.rowCount === 1;
  }
  if (/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalized)) {
    const h = hmac(`recovery|${userId}|${normalized}`);
    const r = await client.query(
      `UPDATE ${S}.users SET totp_recovery_hashes = array_remove(totp_recovery_hashes, $2)
        WHERE id = $1 AND $2 = ANY(totp_recovery_hashes)`,
      [userId, h],
    );
    return r.rowCount === 1;
  }
  return false;
}

export async function requireSecondFactor(userId: string, code: string | undefined, client?: pg.Pool | pg.PoolClient) {
  const ok = await checkSecondFactor(userId, code, client);
  if (!ok) {
    throw new AppError(401, code ? 'MFA_INVALID' : 'MFA_REQUIRED', code ? 'Authenticator code is incorrect' : 'Authenticator code required');
  }
}

export function newRecoveryCodes(userId: string) {
  const codes = Array.from({ length: 8 }, () => `${readableCode(4)}-${readableCode(4)}`);
  return { codes, hashes: codes.map((c) => hmac(`recovery|${userId}|${c}`)) };
}

export const totpIssuer = () => env.SITE_NAME;

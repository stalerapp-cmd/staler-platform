import type { Request, Response } from 'express';
import { placeOf } from '../lib/geo.js';
import crypto from 'node:crypto';
import { isProd } from '../config/env.js';
import { one, pool, S, tx } from '../lib/db.js';
import { sha256, randomToken } from '../lib/crypto.js';
import { unauthorized } from '../lib/errors.js';
import { ACCESS_TTL_SECONDS, signToken } from '../lib/jwt.js';
import { clientIp, userAgent } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { forgetUser } from '../lib/authCache.js';

export const REFRESH_TTL_DAYS = 14;
export const SESSION_MAX_DAYS = 30;
/** Sign-out after this long without use (web, and administrators everywhere). */
export const IDLE_MINUTES = 30;
export const COOKIE_NAME = isProd ? '__Host-st_rt' : 'st_rt';

export interface SessionUser {
  id: string;
  role: string;
  token_version: number;
}

export const isMobileClient = (req: Request) => String(req.headers['x-client'] ?? '').toLowerCase() === 'mobile';

function setRefreshCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    path: '/',
    maxAge: REFRESH_TTL_DAYS * 86_400_000,
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: isProd, sameSite: 'strict', path: '/' });
}

/**
 * Creates a new session (or rotates within a family). Web clients get the
 * refresh token as an HttpOnly SameSite=Strict cookie, the Android app gets
 * it in the body (stored in app-private storage). Access tokens live 10 min
 * and are only ever kept in memory by the clients.
 */
export async function issueSession(
  req: Request,
  res: Response,
  user: SessionUser,
  familyId: string = crypto.randomUUID(),
  familyExpiresAt?: Date,
) {
  const refreshToken = `str_${randomToken(32)}`;
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000);
  const famExp = familyExpiresAt ?? new Date(Date.now() + SESSION_MAX_DAYS * 86_400_000);
  const row = await one<{ id: string }>(
    `INSERT INTO ${S}.refresh_tokens (user_id, family_id, token_hash, expires_at, family_expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, LEAST($4::timestamptz, $5::timestamptz), $5, $6, $7) RETURNING id`,
    [user.id, familyId, sha256(refreshToken), expiresAt.toISOString(), famExp.toISOString(), userAgent(req), clientIp(req)],
  );
  // A brand-new session is a sign-in: remember the device (once per device) for the account's history.
  if (!familyExpiresAt) await rememberDevice(user.id, userAgent(req), clientIp(req)).catch(() => undefined);
  const accessToken = await signToken({ sub: user.id, role: user.role, tv: user.token_version, sid: familyId, typ: 'access' });
  if (isMobileClient(req)) {
    return { accessToken, expiresIn: ACCESS_TTL_SECONDS, refreshToken, sessionId: row!.id };
  }
  setRefreshCookie(res, refreshToken);
  return { accessToken, expiresIn: ACCESS_TTL_SECONDS, sessionId: row!.id };
}

/**
 * Refresh-token rotation with reuse detection: presenting an already-rotated
 * token means it was stolen, so the whole session family is revoked.
 *
 * Done in ONE atomic SQL statement (row-locked with FOR UPDATE) because every
 * round trip to the database costs ~250 ms from the app server.
 */
export async function rotate(req: Request, res: Response, presented: string) {
  const refreshToken = `str_${randomToken(32)}`;
  const r = await one<any>(
    `WITH cur AS (
        SELECT r.id, r.user_id, r.family_id, r.revoked_at, r.expires_at, r.family_expires_at, u.role, u.status, u.token_version,
               -- Inactive too long: on the web (any account) and for administrators everywhere, a session
               -- nobody used for IDLE minutes ends, even if the browser kept it (laptop shut, tab restored).
               (($6::boolean OR u.role = 'admin') AND r.created_at < now() - make_interval(mins => $7)) AS idle
          FROM ${S}.refresh_tokens r JOIN ${S}.users u ON u.id = r.user_id
         WHERE r.token_hash = $1 FOR UPDATE OF r
      ), ok AS (
        SELECT * FROM cur WHERE revoked_at IS NULL AND expires_at > now() AND family_expires_at > now() AND status = 'active' AND NOT idle
      ), ended AS (
        UPDATE ${S}.refresh_tokens SET revoked_at = COALESCE(revoked_at, now())
         WHERE family_id = (SELECT family_id FROM cur WHERE revoked_at IS NULL AND idle) RETURNING 1
      ), ins AS (
        INSERT INTO ${S}.refresh_tokens (user_id, family_id, token_hash, expires_at, family_expires_at, user_agent, ip_address)
        SELECT user_id, family_id, $2, LEAST(now() + make_interval(days => $5), family_expires_at), family_expires_at, $3, $4 FROM ok
        RETURNING id
      ), upd AS (
        UPDATE ${S}.refresh_tokens t SET revoked_at = now(), last_used_at = now(), replaced_by = (SELECT id FROM ins)
          FROM ok WHERE t.id = ok.id RETURNING t.id
      ), reuse AS (
        UPDATE ${S}.refresh_tokens SET revoked_at = COALESCE(revoked_at, now())
         WHERE family_id = (SELECT family_id FROM cur WHERE revoked_at IS NOT NULL) RETURNING 1
      )
      SELECT cur.user_id, cur.family_id, cur.role, cur.status, cur.token_version, cur.revoked_at IS NOT NULL AS reused, cur.idle, (SELECT count(*) FROM ended) AS ended,
             (SELECT id FROM ins) AS new_id, (SELECT count(*) FROM upd) AS rotated, (SELECT count(*) FROM reuse) AS revoked
        FROM cur`,
    [sha256(presented), sha256(refreshToken), userAgent(req), clientIp(req), REFRESH_TTL_DAYS, !isMobileClient(req), IDLE_MINUTES],
  );
  if (!r || !r.new_id) {
    if (r?.reused) await audit({ userId: r.user_id, action: 'auth.refresh_token_reuse_detected' }, req);
    if (r?.idle && !r.reused) await audit({ userId: r.user_id, action: 'auth.session_idle_expired' }, req);
    clearRefreshCookie(res);
    throw unauthorized('Session expired, please sign in again', 'SESSION_EXPIRED');
  }
  const accessToken = await signToken({ sub: r.user_id, role: r.role, tv: r.token_version, sid: r.family_id, typ: 'access' });
  const session = isMobileClient(req)
    ? { accessToken, expiresIn: ACCESS_TTL_SECONDS, refreshToken, sessionId: r.new_id as string }
    : (setRefreshCookie(res, refreshToken), { accessToken, expiresIn: ACCESS_TTL_SECONDS, sessionId: r.new_id as string });
  return { session, userId: r.user_id as string };
}

export async function revokeFamilyByToken(presented: string) {
  await pool.query(
    `UPDATE ${S}.refresh_tokens SET revoked_at = COALESCE(revoked_at, now())
      WHERE family_id = (SELECT family_id FROM ${S}.refresh_tokens WHERE token_hash = $1)`,
    [sha256(presented)],
  );
}

export async function revokeAllSessions(userId: string) {
  await pool.query(`UPDATE ${S}.refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1`, [userId]);
  await pool.query(`UPDATE ${S}.users SET token_version = token_version + 1 WHERE id = $1`, [userId]);
  forgetUser(userId);
}

export function presentedRefreshToken(req: Request): string | null {
  const fromBody = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null;
  const fromCookie = typeof req.cookies?.[COOKIE_NAME] === 'string' ? req.cookies[COOKIE_NAME] : null;
  const t = isMobileClient(req) ? fromBody : fromCookie;
  return t && /^str_[A-Za-z0-9_-]{20,100}$/.test(t) ? t : null;
}

/** One row per device (same browser/app on the same machine), updated on each sign-in. */
export async function rememberDevice(userId: string, ua: string | null, ip: string | null) {
  const d = await one<{ id: string }>(
    `INSERT INTO ${S}.user_devices (user_id, device_key, user_agent, first_ip, last_ip, ips, sign_ins)
     VALUES ($1, md5(COALESCE($2, '')), $2, $3, $3, CASE WHEN $3::text IS NULL THEN '{}'::text[] ELSE ARRAY[$3::text] END, 1)
     ON CONFLICT (user_id, device_key) DO UPDATE SET
       last_ip = EXCLUDED.last_ip, last_seen = now(), sign_ins = ${S}.user_devices.sign_ins + 1,
       ips = CASE WHEN EXCLUDED.last_ip IS NULL OR EXCLUDED.last_ip = ANY(${S}.user_devices.ips) THEN ${S}.user_devices.ips
                  ELSE (${S}.user_devices.ips || EXCLUDED.last_ip)[GREATEST(1, cardinality(${S}.user_devices.ips) - 18):] END
     RETURNING id`,
    [userId, ua, ip],
  );
  if (!d) return;
  await pool.query(`INSERT INTO ${S}.user_signins (device_id, user_id, ip) VALUES ($1, $2, $3)`, [d.id, userId, ip]);
  if (ip) {
    await pool.query(
      `INSERT INTO ${S}.user_device_places (device_id, user_id, ip) VALUES ($1, $2, $3)
       ON CONFLICT (device_id, ip) DO UPDATE SET hits = ${S}.user_device_places.hits + 1, last_seen = now()`,
      [d.id, userId, ip],
    );
    // Look the place up in the background; sign-in never waits for it.
    void placeOf(ip).catch(() => undefined);
  }
}

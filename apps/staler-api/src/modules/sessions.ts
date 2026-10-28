import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { isProd } from '../config/env.js';
import { one, pool, S, tx } from '../lib/db.js';
import { sha256, randomToken } from '../lib/crypto.js';
import { unauthorized } from '../lib/errors.js';
import { ACCESS_TTL_SECONDS, signToken } from '../lib/jwt.js';
import { clientIp, userAgent } from '../lib/http.js';
import { audit } from '../lib/audit.js';

export const REFRESH_TTL_DAYS = 14;
export const SESSION_MAX_DAYS = 30;
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
 */
export async function rotate(req: Request, res: Response, presented: string) {
  const hash = sha256(presented);
  const result = await tx(async (c) => {
    const rt = await one<any>(
      `SELECT r.*, u.role, u.status, u.token_version
         FROM ${S}.refresh_tokens r JOIN ${S}.users u ON u.id = r.user_id
        WHERE r.token_hash = $1 FOR UPDATE OF r`,
      [hash],
      c,
    );
    if (!rt) return { error: 'INVALID' as const };
    if (rt.revoked_at) {
      await c.query(`UPDATE ${S}.refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE family_id = $1`, [rt.family_id]);
      return { error: 'REUSED' as const, userId: rt.user_id };
    }
    if (new Date(rt.expires_at) < new Date() || new Date(rt.family_expires_at) < new Date()) return { error: 'EXPIRED' as const };
    if (rt.status !== 'active') return { error: 'SUSPENDED' as const };
    await c.query(`UPDATE ${S}.refresh_tokens SET revoked_at = now(), last_used_at = now() WHERE id = $1`, [rt.id]);
    return { rt };
  });
  if ('error' in result) {
    if (result.error === 'REUSED') {
      await audit({ userId: result.userId, action: 'auth.refresh_token_reuse_detected' }, req);
    }
    clearRefreshCookie(res);
    throw unauthorized('Session expired, please sign in again', 'SESSION_EXPIRED');
  }
  const { rt } = result;
  const session = await issueSession(req, res, { id: rt.user_id, role: rt.role, token_version: rt.token_version }, rt.family_id, new Date(rt.family_expires_at));
  await pool.query(`UPDATE ${S}.refresh_tokens SET replaced_by = $2 WHERE id = $1`, [rt.id, session.sessionId]);
  return { session, userId: rt.user_id as string };
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
}

export function presentedRefreshToken(req: Request): string | null {
  const fromBody = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null;
  const fromCookie = typeof req.cookies?.[COOKIE_NAME] === 'string' ? req.cookies[COOKIE_NAME] : null;
  const t = isMobileClient(req) ? fromBody : fromCookie;
  return t && /^str_[A-Za-z0-9_-]{20,100}$/.test(t) ? t : null;
}

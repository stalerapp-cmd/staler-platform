import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { one, S } from '../lib/db.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { verifyToken } from '../lib/jwt.js';
import { cachedUser, rememberUser } from '../lib/authCache.js';
import { safeEqual, sha256 } from '../lib/crypto.js';

export interface AuthContext {
  userId: string;
  role: 'user' | 'admin' | 'exchange';
  sid: string;
}
export interface LinkContext {
  tokenId: string;
  userId: string;
  accountId: string;
  scopes: string[];
  perOperationLimit: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      link?: LinkContext;
    }
  }
}

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  const t = h.slice(7).trim();
  return t.length > 0 && t.length < 4096 ? t : null;
}

/**
 * Verifies the access token AND re-checks the user in the database on every
 * request, so suspensions, role changes and "log out everywhere" apply instantly.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = bearer(req);
    if (!token) throw unauthorized();
    let claims;
    try {
      claims = await verifyToken(token, 'access');
    } catch (e: any) {
      throw unauthorized(e?.expired ? 'Session expired' : 'Invalid session', e?.expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN');
    }
    type Row = { role: string; status: string; token_version: number };
    // A cached row is only trusted if it still matches the token's version.
    let u = cachedUser<Row>(claims.sub);
    if (!u || u.token_version !== claims.tv) {
      u = (await one<Row>(`SELECT role, status, token_version FROM ${S}.users WHERE id = $1`, [claims.sub])) ?? undefined;
      if (u) rememberUser(claims.sub, u);
    }
    if (!u || u.token_version !== claims.tv) throw unauthorized('Session revoked', 'SESSION_REVOKED');
    if (u.status !== 'active') throw forbidden('Account is suspended', 'ACCOUNT_SUSPENDED');
    req.auth = { userId: claims.sub, role: u.role as AuthContext['role'], sid: claims.sid };
    next();
  } catch (e) {
    next(e);
  }
}

export const requireRole =
  (...roles: AuthContext['role'][]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.role)) return next(forbidden());
    next();
  };

const EXCHANGE_TOKEN_HASH = sha256(env.EXCHANGE_API_TOKEN);

/** Server-to-server auth for the exchange operator (S-Taler API). */
export function requireExchange(req: Request, _res: Response, next: NextFunction) {
  const t = bearer(req);
  if (!t || !safeEqual(sha256(t), EXCHANGE_TOKEN_HASH)) return next(unauthorized('Exchange credentials required'));
  next();
}

/** Scoped wallet-link token (issued to S-Taler for one customer account). */
export const requireLink =
  (scope: string) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const t = bearer(req);
      if (!t || !t.startsWith('tbl_')) throw unauthorized('Link token required');
      const row = await one<any>(
        `SELECT t.id, t.user_id, t.account_id, t.scopes, t.per_operation_limit, u.status, a.is_locked
           FROM ${S}.api_tokens t
           JOIN ${S}.users u ON u.id = t.user_id
           JOIN ${S}.bank_accounts a ON a.id = t.account_id
          WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND t.expires_at > now()`,
        [sha256(t)],
      );
      if (!row) throw unauthorized('Link token is invalid, expired or revoked', 'LINK_REVOKED');
      if (row.status !== 'active') throw forbidden('Account is suspended', 'ACCOUNT_SUSPENDED');
      if (!row.scopes.includes(scope)) throw forbidden('Token does not allow this operation', 'SCOPE');
      req.link = {
        tokenId: row.id,
        userId: row.user_id,
        accountId: row.account_id,
        scopes: row.scopes,
        perOperationLimit: row.per_operation_limit,
      };
      await one(`UPDATE ${S}.api_tokens SET last_used_at = now() WHERE id = $1`, [row.id]);
      next();
    } catch (e) {
      next(e);
    }
  };

import type { NextFunction, Request, Response } from 'express';
import { one, S } from '../lib/db.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { verifyToken } from '../lib/jwt.js';
import { cachedUser, rememberUser } from '../lib/authCache.js';

export type Role = 'user' | 'merchant' | 'exchange' | 'admin';
export interface AuthContext {
  userId: string;
  role: Role;
  adminLevel: string | null;
  sid: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      rawBody?: Buffer;
    }
  }
}

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  const t = h.slice(7).trim();
  return t.length > 0 && t.length < 4096 ? t : null;
}

/** Access token + live DB check (suspension, role change and global logout apply instantly). */
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
    type Row = { role: Role; status: string; token_version: number; admin_level: string | null };
    // A cached row is only trusted if it still matches the token's version.
    let u = cachedUser<Row>(claims.sub);
    if (!u || u.token_version !== claims.tv) {
      u = (await one<Row>(`SELECT role, status, token_version, admin_level FROM ${S}.users WHERE id = $1`, [claims.sub])) ?? undefined;
      if (u) rememberUser(claims.sub, u);
    }
    if (!u || u.token_version !== claims.tv) throw unauthorized('Session revoked', 'SESSION_REVOKED');
    if (u.status !== 'active') throw forbidden('Account is suspended', 'ACCOUNT_SUSPENDED');
    req.auth = { userId: claims.sub, role: u.role, adminLevel: u.admin_level, sid: claims.sid };
    next();
  } catch (e) {
    next(e);
  }
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.role)) return next(forbidden());
    next();
  };

export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.auth?.role !== 'admin' || req.auth.adminLevel !== 'super_admin') return next(forbidden('Super admin only'));
  next();
}

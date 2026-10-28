import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

const SECRET = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = 'talerbank';
const AUDIENCE = 'talerbank-api';
export const ACCESS_TTL_SECONDS = 10 * 60;

export type TokenType = 'access' | 'mfa';
export interface AccessClaims {
  sub: string;
  role: string;
  tv: number;
  sid: string;
  typ: TokenType;
}

export async function signToken(claims: AccessClaims, ttlSeconds = ACCESS_TTL_SECONDS): Promise<string> {
  return new SignJWT({ role: claims.role, tv: claims.tv, sid: claims.sid, typ: claims.typ })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(SECRET);
}

/** Verifies signature, algorithm (HS256 only — "none"/RS confusion is impossible), issuer, audience, expiry and type. */
export async function verifyToken(token: string, expected: TokenType): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
      clockTolerance: 5,
    });
    if (payload.typ !== expected || typeof payload.sub !== 'string') throw new Error('wrong token type');
    return {
      sub: payload.sub,
      role: String(payload.role),
      tv: Number(payload.tv),
      sid: String(payload.sid),
      typ: expected,
    };
  } catch (e) {
    if (e instanceof joseErrors.JWTExpired) throw Object.assign(new Error('expired'), { expired: true });
    throw new Error('invalid token');
  }
}

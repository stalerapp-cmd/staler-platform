import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import rateLimit, { type Options } from 'express-rate-limit';
import crypto from 'node:crypto';
import { corsOrigins, env, isProd } from '../config/env.js';

const GOOGLE = env.GOOGLE_CLIENT_ID ? ['https://accounts.google.com'] : [];

/** Strict security headers. The SPA is built without inline scripts, so CSP can be tight. */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      scriptSrc: ["'self'", ...GOOGLE],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', ...GOOGLE],
      frameSrc: GOOGLE.length ? GOOGLE : ["'none'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      // Product photos and avatars live in Supabase Storage.
      // + OpenStreetMap tiles for order tracking maps.
      imgSrc: ["'self'", 'data:', 'blob:', 'https://*.supabase.co', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org'],
      connectSrc: ["'self'", ...GOOGLE],
      mediaSrc: ["'self'", 'blob:', 'https://*.supabase.co'],
      workerSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: isProd ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-site' },
  // Origin only (never paths/queries) — Google sign-in needs to see which site it runs on.
  referrerPolicy: { policy: 'strict-origin' },
  strictTransportSecurity: isProd ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
});

export function permissionsPolicy(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()');
  next();
}

/** Every request gets an id that is echoed back and attached to logs/errors. */
export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = String(req.headers['x-request-id'] ?? '');
  const id = /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  (req as any).id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

/**
 * CORS with an explicit allow-list (the web app is same-origin and needs none;
 * the Android app runs on https://localhost). Credentials are never allowed
 * cross-origin, so cookies can't be abused from another site.
 */
export function cors(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  if (origin && corsOrigins().includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization,Content-Type,Idempotency-Key,X-Client,X-Requested-With,X-Request-Id,X-Store-Id',
    );
    res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id,RateLimit,RateLimit-Policy,Retry-After');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

/** Prevents caching of API responses that may contain personal/financial data. */
export function noStore(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
}

function limiter(opts: Partial<Options>) {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.DISABLE_RATE_LIMIT,
    handler: (_req, res) =>
      res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down' } }),
    ...opts,
  });
}

export const globalLimiter = limiter({ windowMs: 60_000, limit: 300 });
/** IPv6 clients are grouped by their /64 network (one device can hold many addresses there). */
const ipKey = (ip: string | undefined) => {
  const v = (ip ?? '').replace(/^::ffff:/, '');
  return v.includes(':') ? v.split(':').slice(0, 4).join(':') : v;
};
const accountOf = (body: any) => String(body?.email ?? body?.login ?? body?.username ?? '').trim().toLowerCase().slice(0, 254);

/**
 * Sign-in attempts are counted per IP *and* account: guessing one account's password
 * is stopped quickly, while people sharing an IP (campus Wi-Fi, mobile carriers) don't
 * lock each other out. A looser per-IP cap still stops spraying many accounts.
 */
const authPerAccount = limiter({ windowMs: 15 * 60_000, limit: 10, keyGenerator: (req) => `${ipKey(req.ip)}|${accountOf(req.body)}`, validate: false });
const authPerIp = limiter({ windowMs: 15 * 60_000, limit: 300, keyGenerator: (req) => ipKey(req.ip), validate: false });
export const authLimiter = (req: Request, res: Response, next: NextFunction) => authPerIp(req, res, (err?: unknown) => (err ? next(err) : authPerAccount(req, res, next)));
export const codeLimiter = limiter({ windowMs: 15 * 60_000, limit: 15 });
export const registerLimiter = limiter({ windowMs: 60 * 60_000, limit: 10 });
export const moneyLimiter = limiter({ windowMs: 60_000, limit: 30 });
export const integrationLimiter = limiter({ windowMs: 60_000, limit: 600 });

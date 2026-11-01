import { isIP } from 'node:net';
import type { NextFunction, Request, Response } from 'express';

/** Addresses that can never be a visitor on the internet (Render's own hops, loopback…). */
export function isPrivateIp(ip: string): boolean {
  const v = ip.replace(/^::ffff:/i, '');
  if (isIP(v) === 4) {
    const [a, b] = v.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (isIP(v) === 6) {
    const l = v.toLowerCase();
    return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
  }
  return true;
}

const clean = (v: unknown) => {
  const s = String(v ?? '').trim().replace(/^::ffff:/i, '');
  return isIP(s) ? s : null;
};

/**
 * The visitor's real address. Render sits behind Cloudflare and an internal load
 * balancer, so req.ip is a 10.x hop. Cloudflare's CF-Connecting-IP is set by the edge
 * (a visitor can't forge it there); otherwise the nearest public address in
 * X-Forwarded-For, read from the right so a forged left part is ignored.
 */
export function realIp(req: Request): string {
  for (const h of ['cf-connecting-ip', 'true-client-ip', 'x-real-ip']) {
    const ip = clean(req.headers[h]);
    if (ip && !isPrivateIp(ip)) return ip;
  }
  const chain = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map(clean)
    .filter((x): x is string => !!x);
  for (let i = chain.length - 1; i >= 0; i--) if (!isPrivateIp(chain[i]!)) return chain[i]!;
  return clean(req.socket.remoteAddress) ?? chain[0] ?? 'unknown';
}

/** Makes req.ip the real visitor address for everything after it (rate limits, logs, audit). */
export function realIpMiddleware(req: Request, _res: Response, next: NextFunction) {
  const ip = realIp(req);
  Object.defineProperty(req, 'ip', { value: ip, configurable: true });
  next();
}

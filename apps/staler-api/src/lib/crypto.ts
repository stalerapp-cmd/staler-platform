import crypto from 'node:crypto';
import { env } from '../config/env.js';

const KEY = Buffer.from(env.ENCRYPTION_KEY, 'base64');
const PREV_KEY = env.ENCRYPTION_KEY_PREVIOUS ? Buffer.from(env.ENCRYPTION_KEY_PREVIOUS, 'base64') : null;

/** Short fingerprint so we know which key encrypted a value (supports rotation). */
const kid = (k: Buffer) => crypto.createHash('sha256').update(k).digest('hex').slice(0, 8);
const KEY_ID = kid(KEY);
const PREV_ID = PREV_KEY ? kid(PREV_KEY) : null;

/** Separate sub-keys per purpose (HKDF) so one key never serves two jobs. */
function subKey(purpose: string): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', KEY, Buffer.alloc(0), Buffer.from(purpose), 32));
}
const HMAC_KEY = subKey('staler/hmac/v1');

/** AES-256-GCM authenticated encryption. Output: gcm1:<kid>:<iv>:<tag>:<ciphertext> */
export function encrypt(plain: string, aad = ''): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  if (aad) c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['gcm1', KEY_ID, iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
}

export function decrypt(payload: string, aad = ''): string {
  const parts = payload.split(':');
  if (parts.length !== 5 || parts[0] !== 'gcm1') throw new Error('unsupported ciphertext format');
  const [, id, ivB, tagB, ctB] = parts as [string, string, string, string, string];
  const key = id === KEY_ID ? KEY : id === PREV_ID && PREV_KEY ? PREV_KEY : null;
  if (!key) throw new Error('unknown encryption key');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64url'));
  if (aad) d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ctB, 'base64url')), d.final()]).toString('utf8');
}

export const sha256 = (v: string | Buffer) => crypto.createHash('sha256').update(v).digest('hex');

export const hmac = (v: string) => crypto.createHmac('sha256', HMAC_KEY).update(v).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still spend comparable time so length is not leaked by timing.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

/** URL-safe random token with `bytes` of entropy. */
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Uniformly random numeric code (no modulo bias). */
export function numericCode(digits = 6): string {
  let out = '';
  for (let i = 0; i < digits; i++) out += crypto.randomInt(0, 10).toString();
  return out;
}

/** Human-friendly code without ambiguous characters (0/O, 1/I/L). */
export function readableCode(length = 8): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[crypto.randomInt(0, alphabet.length)];
  return out;
}

/** Hash of a one-time code bound to its purpose + subject, so codes can't be replayed elsewhere. */
export const codeHash = (purpose: string, subject: string, code: string) =>
  hmac(`${purpose}|${subject.toLowerCase()}|${code}`);

/**
 * Reads values written by the OLD backend (AES-256-CBC, "iv:ciphertext" in
 * base64, or the messages' "ENC|iv|ct" / "enc:iv:ct" hex formats).
 * Returns null when the value can't be decrypted with the configured legacy key.
 */
export function legacyDecrypt(payload: string, rawKey: string | undefined): string | null {
  if (!rawKey) return null;
  try {
    const key = Buffer.alloc(32);
    Buffer.from(rawKey, 'utf8').copy(key);
    let iv: Buffer;
    let ct: Buffer;
    if (payload.startsWith('ENC|')) {
      const [, i, c] = payload.split('|');
      iv = Buffer.from(i!, 'hex');
      ct = Buffer.from(c!, 'hex');
    } else if (payload.startsWith('enc:')) {
      const [, i, c] = payload.split(':');
      iv = Buffer.from(i!, 'hex');
      ct = Buffer.from(c!, 'hex');
    } else {
      const idx = payload.indexOf(':');
      if (idx < 0) return null;
      iv = Buffer.from(payload.slice(0, idx), 'base64');
      ct = Buffer.from(payload.slice(idx + 1), 'base64');
    }
    if (iv.length !== 16) return null;
    const d = crypto.createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

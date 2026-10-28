import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

/**
 * Argon2id (OWASP recommended parameters). Legacy bcrypt hashes from the old
 * system still verify, and are transparently upgraded on the next login.
 */
const ARGON_OPTS = { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/**
 * Hashes that were published in old setup scripts/README. An account whose
 * password hash is one of these is treated as having NO usable password.
 */
const PUBLISHED_DEFAULT_HASHES = new Set([
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCgZvxa8jB4bP.7.1nxJO6e',
  '$2b$12$placeholder',
]);

// A fixed dummy hash, used so that "unknown user" and "wrong password" take the same time.
let dummyHash: string | null = null;

export async function hashPassword(plain: string): Promise<string> {
  return argonHash(plain, ARGON_OPTS);
}

export async function verifyPassword(plain: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored || PUBLISHED_DEFAULT_HASHES.has(stored)) {
    dummyHash ??= await argonHash('timing-equaliser-not-a-password', ARGON_OPTS);
    await argonVerify(dummyHash, plain).catch(() => false);
    return false;
  }
  try {
    if (stored.startsWith('$argon2')) return await argonVerify(stored, plain);
    if (/^\$2[aby]\$\d{2}\$/.test(stored)) return await bcrypt.compare(plain, stored);
  } catch {
    return false;
  }
  return false;
}

export const needsRehash = (stored: string) => !stored.startsWith('$argon2id$');

export const isPublishedDefaultHash = (stored: string | null | undefined) =>
  !stored || PUBLISHED_DEFAULT_HASHES.has(stored);

const COMMON = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123',
  'admin123', 'admin@2026', 'welcome1', 'iloveyou', 'letmein123', 'palestine', 'taler123',
]);

/** Password policy: 10–128 chars, upper, lower, digit, symbol, not a common password. */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password is too long')
  .refine((p) => /[a-z]/.test(p), 'Password needs a lowercase letter')
  .refine((p) => /[A-Z]/.test(p), 'Password needs an uppercase letter')
  .refine((p) => /\d/.test(p), 'Password needs a digit')
  .refine((p) => /[^A-Za-z0-9]/.test(p), 'Password needs a symbol')
  .refine((p) => !COMMON.has(p.toLowerCase()), 'This password is too common');

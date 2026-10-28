import { z } from 'zod';

/**
 * Every environment variable is validated once at boot. A misconfigured
 * production deployment refuses to start instead of running insecurely.
 */
const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const base64Key = z
  .string()
  .refine((v) => {
    try {
      return Buffer.from(v, 'base64').length === 32;
    } catch {
      return false;
    }
  }, 'must be 32 random bytes encoded as base64 (openssl rand -base64 32)');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DB_SCHEMA: z.string().regex(/^[a-z_][a-z0-9_]*$/).default('talerbank'),
  DB_SSL: z.enum(['disable', 'require', 'verify']).default('require'),
  DB_CA_CERT: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  RUN_MIGRATIONS: bool.prefault('true'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY: base64Key,
  /** Optional previous key, still accepted for decryption during key rotation. */
  ENCRYPTION_KEY_PREVIOUS: base64Key.optional(),

  PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default(''),
  WEB_DIST_DIR: z.string().optional(),

  BANK_NAME: z.string().min(1).max(60).default('TalerBank'),
  BANK_BIC: z.string().regex(/^[A-Z0-9]{4,11}$/).default('TALERPS1'),
  CURRENCY: z.string().regex(/^[A-Z]{2,11}$/).default('PS'),
  MAX_TRANSFER: z.string().regex(/^\d+(\.\d{1,2})?$/).default('10000'),
  DAILY_TRANSFER_LIMIT: z.string().regex(/^\d+(\.\d{1,2})?$/).default('50000'),
  SIGNUP_BONUS: z.string().regex(/^\d+(\.\d{1,2})?$/).default('0'),
  ADMIN_DEBIT_THRESHOLD: z.string().regex(/^\d+(\.\d{1,2})?$/).default('100000000'),

  /** Shared secret used by S-Taler (the exchange operator) to call the wire gateway + integration API. */
  EXCHANGE_API_TOKEN: z.string().min(32, 'EXCHANGE_API_TOKEN must be at least 32 characters'),
  /** Where withdrawal confirmations are pushed (S-Taler API). Optional — S-Taler also polls. */
  STALER_WEBHOOK_URL: z.string().url().optional(),
  WEBHOOK_SECRET: z.string().min(32).optional(),

  BANK_ADMIN_EMAIL: z.string().email().optional(),
  BANK_ADMIN_PASSWORD: z.string().min(12).optional(),

  MAIL_MODE: z.enum(['smtp', 'brevo', 'resend', 'log', 'memory']).default('log'),
  /** HTTPS relay that speaks SMTP for us (Render's free plan blocks SMTP ports). */
  MAIL_RELAY_URL: z.string().url().optional(),
  MAIL_RELAY_SECRET: z.string().min(16).optional(),
  /** API key for MAIL_MODE=brevo or resend. */
  MAIL_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_SECURE: bool.prefault('true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Disable rate limiting (tests only — refused in production). */
  DISABLE_RATE_LIMIT: bool.prefault('false'),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  // Empty strings (e.g. unset dashboard fields) count as "not set".
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${issues}`);
    throw new Error('Invalid environment configuration');
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (env.DISABLE_RATE_LIMIT) throw new Error('DISABLE_RATE_LIMIT is not allowed in production');
    if (env.DB_SSL === 'disable') throw new Error('DB_SSL=disable is not allowed in production');
    if (env.MAIL_MODE === 'memory') throw new Error('MAIL_MODE=memory is not allowed in production');
    if (!env.PUBLIC_URL.startsWith('https://')) throw new Error('PUBLIC_URL must be https in production');
  }
  if (env.STALER_WEBHOOK_URL && !env.WEBHOOK_SECRET) {
    throw new Error('WEBHOOK_SECRET is required when STALER_WEBHOOK_URL is set');
  }
  return env;
}

export const env: Env = load();

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

export function corsOrigins(): string[] {
  const list = env.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // The Android app (Capacitor) runs on these origins.
  return Array.from(new Set([...list, 'https://localhost', 'capacitor://localhost']));
}

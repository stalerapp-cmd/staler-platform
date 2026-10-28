import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Structured logger. Secrets are redacted at the source so they can never
 * end up in log storage, even when a whole request/response object is logged.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'talerbank-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.newPassword',
      '*.currentPassword',
      '*.token',
      '*.refreshToken',
      '*.accessToken',
      '*.code',
      '*.totp',
      '*.secret',
    ],
    censor: '[redacted]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

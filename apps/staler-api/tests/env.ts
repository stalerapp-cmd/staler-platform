// S-Taler test environment — set BEFORE application modules are imported.
export const BANK_PORT = Number(process.env.TEST_BANK_PORT ?? 4555);
export const STALER_PORT = Number(process.env.TEST_STALER_PORT ?? 4556);
export const EXCHANGE_TOKEN = 'exchange-token-shared-between-apps-0123456789';
export const WEBHOOK_SECRET = 'webhook-secret-shared-between-apps-0123456789';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL_STALER ?? 'postgres://postgres@127.0.0.1:5433/staler_test';
process.env.DB_SSL = 'disable';
process.env.JWT_SECRET = 'staler-test-jwt-secret-long-enough-0123456789'; // gitleaks:allow (test-only value)
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
process.env.LEGACY_ENCRYPTION_KEY = 'changemechangemechangemechangeme';
process.env.EXCHANGE_API_TOKEN = EXCHANGE_TOKEN;
process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.BANK_API_URL = `http://127.0.0.1:${BANK_PORT}`;
process.env.MAIL_MODE = 'memory';
process.env.LOG_LEVEL = 'silent';
process.env.DISABLE_RATE_LIMIT = 'true';
process.env.ADMIN_EMAIL = 'super@staler.test';
process.env.ADMIN_PASSWORD = 'Sup3r!Admin#Pass';
process.env.PUBLIC_URL = `http://127.0.0.1:${STALER_PORT}`;
process.env.MAX_TRANSFER = '5000';
process.env.DAILY_TRANSFER_LIMIT = '9000';
process.env.RECONCILE_INTERVAL_MS = '600000';

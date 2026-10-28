// Test environment — set BEFORE any application module is imported.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL_BANK ?? 'postgres://postgres@127.0.0.1:5433/talerbank_test';
process.env.DB_SSL = 'disable';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-0123456789'; // gitleaks:allow (test-only value)
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.EXCHANGE_API_TOKEN = 'exchange-token-for-tests-0123456789abcdef';
process.env.MAIL_MODE = 'memory';
process.env.LOG_LEVEL = 'silent';
process.env.DISABLE_RATE_LIMIT = 'true';
process.env.BANK_ADMIN_EMAIL = 'admin@talerbank.local';
process.env.BANK_ADMIN_PASSWORD = 'Adm1n!Strong#Pass';
process.env.SIGNUP_BONUS = '1000';
process.env.PUBLIC_URL = 'http://bank.test';
process.env.MAX_TRANSFER = '5000';
process.env.DAILY_TRANSFER_LIMIT = '8000';

import { env } from './config/env.js';
import { createApp } from './app.js';
import { migrate } from './db/migrate.js';
import { bootstrap } from './db/bootstrap.js';
import { logger } from './lib/logger.js';
import { pool, S, warmPool } from './lib/db.js';

async function main() {
  if (env.RUN_MIGRATIONS) await migrate();
  await bootstrap();
  await warmPool();
  // Keep pooled connections alive between visits.
  setInterval(() => void warmPool(2), 60_000).unref();
  const app = createApp();
  const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, `${env.BANK_NAME} API listening`));
  server.headersTimeout = 30_000;
  server.requestTimeout = 30_000;

  // Housekeeping: expire stale artefacts every 10 minutes.
  const timer = setInterval(async () => {
    try {
      await pool.query(`DELETE FROM ${S}.idempotency_keys WHERE created_at < now() - interval '2 days'`);
      await pool.query(`DELETE FROM ${S}.refresh_tokens WHERE family_expires_at < now() - interval '7 days'`);
      await pool.query(`DELETE FROM ${S}.pending_users WHERE expires_at < now()`);
      await pool.query(`UPDATE ${S}.withdrawal_operations SET status = 'aborted', aborted_at = now()
                         WHERE status IN ('pending','selected') AND expires_at < now()`);
    } catch (err) {
      logger.warn({ err }, 'housekeeping failed');
    }
  }, 10 * 60_000);
  timer.unref();

  const shutdown = (sig: string) => {
    logger.info({ sig }, 'shutting down');
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandled rejection'));

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});

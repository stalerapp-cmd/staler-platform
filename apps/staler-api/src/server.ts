import { env } from './config/env.js';
import { createApp } from './app.js';
import { migrate } from './db/migrate.js';
import { bootstrap } from './db/bootstrap.js';
import { logger } from './lib/logger.js';
import { pool } from './lib/db.js';
import { reconcilePending } from './modules/bank.js';
import { housekeeping } from './modules/housekeeping.js';

async function main() {
  if (env.RUN_MIGRATIONS) await migrate();
  await bootstrap();
  const app = createApp();
  const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, `${env.SITE_NAME} API listening`));
  server.headersTimeout = 30_000;
  server.requestTimeout = 60_000;

  const reconcile = setInterval(() => {
    reconcilePending().catch((err) => logger.warn({ err }, 'reconcile failed'));
  }, env.RECONCILE_INTERVAL_MS);
  reconcile.unref();
  const hk = setInterval(() => {
    housekeeping().catch((err) => logger.warn({ err }, 'housekeeping failed'));
  }, 10 * 60_000);
  hk.unref();

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

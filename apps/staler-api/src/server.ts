import { env } from './config/env.js';
import { createApp } from './app.js';
import { migrate } from './db/migrate.js';
import { bootstrap } from './db/bootstrap.js';
import { logger } from './lib/logger.js';
import { checkMailSetup } from './lib/mailer.js';
import { pool, warmPool } from './lib/db.js';
import { reconcilePending } from './modules/bank.js';
import { housekeeping } from './modules/housekeeping.js';
import { runPayouts } from './modules/people.js';
import { iceServers } from './modules/calls.js';
import { startPushDispatcher } from './modules/push.js';

/**
 * During a deploy the old copy still holds its connections; if the shared pooler is
 * momentarily full, wait and try again instead of failing the deploy.
 */
async function withRetry<T>(what: string, fn: () => Promise<T>): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const busy = /EMAXCONNSESSION|max clients reached|too many clients|ECONNREFUSED|ETIMEDOUT|timeout exceeded when trying to connect/i.test(String(err?.message ?? err));
      if (!busy || i >= 12) throw err;
      logger.warn({ what, attempt: i }, 'database busy at startup, retrying');
      await new Promise((r) => setTimeout(r, Math.min(15_000, 2_000 * i)));
    }
  }
}

async function main() {
  if (env.RUN_MIGRATIONS) await withRetry('migrate', migrate);
  await withRetry('bootstrap', bootstrap);
  await warmPool();
  void checkMailSetup();
  // Keep pooled connections alive between visits.
  setInterval(() => void warmPool(2), 60_000).unref();
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
  // Recurring transfers that are due.
  const payouts = setInterval(() => {
    runPayouts().catch((err) => logger.warn({ err }, 'payouts failed'));
  }, 2 * 60_000);
  payouts.unref();
  // Device notifications for people who turned them on.
  startPushDispatcher();
  // Check the call relay once at start, so the logs say whether calls have TURN.
  if (process.env.ICE_URL) void iceServers();
  // TalerBank sleeps after a quiet spell on the hosting plan; while S-Taler is awake, keep it awake too.
  const bankWake = setInterval(() => {
    fetch(`${env.BANK_API_URL.replace(/\/+$/, '')}/health`, { signal: AbortSignal.timeout(20_000) }).catch(() => undefined);
  }, 9 * 60_000);
  bankWake.unref();

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

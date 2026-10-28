import express, { type Express } from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { makeIndexRenderer, mountReleaseRoute, mountSeoFiles } from './lib/site.js';
import { site } from './config/site.js';
import { smsEnabled } from './lib/sms.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { pool, S } from './lib/db.js';
import { cors, globalLimiter, noStore, permissionsPolicy, requestId, securityHeaders } from './middleware/security.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './modules/auth.js';
import { bankingRouter } from './modules/banking.js';
import { withdrawalsRouter, integrationRouter } from './modules/withdrawals.js';
import { linkCustomerRouter, linkExchangeRouter } from './modules/link.js';
import { wireRouter } from './modules/wire.js';
import { adminRouter } from './modules/admin.js';

let maintenanceCache = { at: 0, on: false };
async function maintenanceOn(): Promise<boolean> {
  if (Date.now() - maintenanceCache.at < 10_000) return maintenanceCache.on;
  try {
    const r = await pool.query(`SELECT value FROM ${S}.settings WHERE key = 'maintenance_mode'`);
    maintenanceCache = { at: Date.now(), on: r.rows[0]?.value === true };
  } catch {
    maintenanceCache = { at: Date.now(), on: false };
  }
  return maintenanceCache.on;
}

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.set('etag', false);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as any).id,
      autoLogging: { ignore: (req) => req.url === '/health' },
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url.split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(securityHeaders, permissionsPolicy, cors);
  app.use(compression());
  app.use(express.json({ limit: '64kb', strict: true }));
  app.use(cookieParser());
  app.use(globalLimiter);

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', service: 'talerbank-api', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded' });
    }
  });

  // Money-moving customer endpoints pause during maintenance.
  app.use(['/api/transfers', '/api/withdrawals', '/api/payment-requests', '/link/withdraw'], async (req, res, next) => {
    if (req.method !== 'GET' && (await maintenanceOn())) {
      return res.status(503).json({ success: false, error: { code: 'MAINTENANCE', message: 'The bank is under maintenance. Please try again soon.' } });
    }
    next();
  });

  app.get('/api/config', noStore, (_req, res) => {
    res.json({
      success: true,
      data: {
        bankName: env.BANK_NAME,
        bic: env.BANK_BIC,
        currency: env.CURRENCY,
        maxTransfer: env.MAX_TRANSFER,
        dailyLimit: env.DAILY_TRANSFER_LIMIT,
        publicUrl: env.PUBLIC_URL,
        googleClientId: env.GOOGLE_CLIENT_ID ?? null,
        sms: smsEnabled(),
      },
    });
  });

  app.use('/api/auth', noStore, authRouter);
  app.use('/api/withdrawals', noStore, withdrawalsRouter);
  app.use('/api/admin', noStore, adminRouter);
  app.use('/api', noStore, linkCustomerRouter);
  app.use('/api', noStore, bankingRouter);
  app.use('/taler-integration', noStore, integrationRouter);
  app.use('/taler-wire-gateway', noStore, wireRouter);
  app.use('/link', noStore, linkExchangeRouter);

  // ---- the web app (same origin => cookies stay first-party and CSP 'self' works)
  mountReleaseRoute(app);
  mountSeoFiles(app, site);

  const dist = env.WEB_DIST_DIR ? resolve(env.WEB_DIST_DIR) : resolve(process.cwd(), '../bank-web/dist');
  if (existsSync(join(dist, 'index.html'))) {
    const renderIndex = makeIndexRenderer(join(dist, 'index.html'), site);
    app.use(
      express.static(dist, {
        index: false,
        // Hashed bundles never change; everything else must be revalidated so a
        // new deploy (new icon, new manifest, new index.html) shows up at once.
        setHeaders: (res, path) => {
          res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
        },
      }),
    );
    app.get(/^\/assets\//, (_req, res) => res.status(404).end());
    app.get(/^\/(?!api\/|taler-|link\/|health).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.type('html').send(renderIndex(_req));
    });
    logger.info({ dist }, 'serving web app');
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

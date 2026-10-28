import express, { type Express } from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { makeIndexRenderer, mountReleaseRoute, mountSeoFiles } from './lib/site.js';
import { site } from './config/site.js';
import { smsEnabled } from './lib/sms.js';
import { z } from 'zod';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { one, pool, S } from './lib/db.js';
import { publicFile } from './lib/storage.js';
import { cors, globalLimiter, noStore, permissionsPolicy, requestId, securityHeaders } from './middleware/security.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './modules/auth.js';
import { notificationsRouter, walletRouter } from './modules/wallet.js';
import { bankRouter, webhookRouter } from './modules/bank.js';
import { exchangeRouter } from './modules/exchange.js';
import { merchantRouter, storeRouter } from './modules/commerce.js';
import { messagesRouter } from './modules/messages.js';
import { contactsRouter } from './modules/contacts.js';
import { adminRouter } from './modules/admin.js';

let settingsCache = { at: 0, value: null as any };
export async function siteSettings() {
  if (Date.now() - settingsCache.at < 10_000 && settingsCache.value) return settingsCache.value;
  try {
    const s = await one(`SELECT site_name, theme, maintenance_mode, allow_registrations, announcement FROM ${S}.system_settings WHERE id = 1`);
    settingsCache = { at: Date.now(), value: s ?? {} };
  } catch {
    settingsCache = { at: Date.now(), value: {} };
  }
  return settingsCache.value;
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
  app.use(
    express.json({
      limit: '64kb',
      strict: true,
      verify: (req, _res, buf) => {
        if ((req as any).originalUrl?.startsWith('/api/bank/webhook')) (req as any).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(cookieParser());
  // Only API calls count — pages, scripts, fonts and icons never do (shared IPs like campus
  // Wi-Fi or mobile carriers would otherwise lock everyone out of loading the site).
  app.use('/api', globalLimiter);

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', service: 'staler-api', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded' });
    }
  });

  app.get('/api/config', noStore, async (_req, res) => {
    const s = await siteSettings();
    res.json({
      success: true,
      data: {
        siteName: s.site_name ?? env.SITE_NAME,
        theme: s.theme ?? 'emerald',
        currency: env.CURRENCY,
        maxTransfer: env.MAX_TRANSFER,
        dailyLimit: env.DAILY_TRANSFER_LIMIT,
        bankUrl: env.BANK_PUBLIC_URL ?? env.BANK_API_URL,
        googleClientId: env.GOOGLE_CLIENT_ID ?? null,
        sms: smsEnabled(),
        allowRegistrations: s.allow_registrations ?? true,
        maintenance: s.maintenance_mode ?? false,
        announcement: s.announcement ?? null,
      },
    });
  });

  // Money movements pause during maintenance (admins can still act).
  app.use(['/api/wallet/transfer', '/api/bank/withdraw', '/api/bank/deposit', '/api/bank/qr', '/api/store/checkout', '/api/exchange'], async (req, res, next) => {
    if (req.method === 'GET') return next();
    const s = await siteSettings();
    if (s.maintenance_mode) {
      return res.status(503).json({ success: false, error: { code: 'MAINTENANCE', message: 'S-Taler is under maintenance. Please try again soon.' } });
    }
    next();
  });

  app.use('/api/auth', noStore, authRouter);
  app.use('/api/wallet', noStore, walletRouter);
  app.use('/api/notifications', noStore, notificationsRouter);
  app.use('/api/bank/webhook', noStore, webhookRouter);
  app.use('/api/bank', noStore, bankRouter);
  app.use('/api/exchange', noStore, exchangeRouter);
  app.use('/api/store', noStore, storeRouter);
  app.use('/api/merchant', noStore, merchantRouter);
  app.use('/api/messages', noStore, messagesRouter);
  app.use('/api/contacts', noStore, contactsRouter);
  app.use('/api/admin', noStore, adminRouter);

  // Public images stored in the database (when Supabase Storage isn't configured).
  app.get('/files/:id', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const f = await publicFile(id);
      if (!f) return res.status(404).end();
      res.setHeader('Content-Type', f.mime);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      res.send(f.data);
    } catch (e) {
      next(e);
    }
  });

  mountReleaseRoute(app);
  mountSeoFiles(app, site);

  const dist = env.WEB_DIST_DIR ? resolve(env.WEB_DIST_DIR) : resolve(process.cwd(), '../staler-web/dist');
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
    app.get(/^\/(?!api\/|files\/|health).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.type('html').send(renderIndex(_req));
    });
    logger.info({ dist }, 'serving web app');
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

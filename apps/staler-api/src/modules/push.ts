import { Router } from 'express';
import webpush from 'web-push';
import { z } from 'zod';
import { pool, S } from '../lib/db.js';
import { ah } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';

/**
 * Device notifications (Web Push). Nothing is sent unless the person turned it on for
 * that device (the browser asks them first). A small dispatcher sends notifications only
 * after they are saved — never from inside a transaction that might still roll back.
 * Payloads are encrypted end-to-end by the Web Push protocol; we send only the title,
 * a short body and the in-app link.
 */
const PUBLIC = process.env.VAPID_PUBLIC_KEY ?? '';
const PRIVATE = process.env.VAPID_PRIVATE_KEY ?? '';
export const pushEnabled = !!(PUBLIC && PRIVATE);
if (pushEnabled) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@staler.ps', PUBLIC, PRIVATE);

export const pushRouter = Router();

/** The public key browsers need to subscribe (empty = device notifications are off on this server). */
pushRouter.get(
  '/key',
  ah(async (_req, res) => {
    res.json({ success: true, data: { key: pushEnabled ? PUBLIC : null } });
  }),
);

const sub = z
  .object({
    endpoint: z.string().url().max(1000).refine((u) => u.startsWith('https://'), 'Bad push address'),
    keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }).strict(),
    language: z.enum(['ar', 'en']).default('ar'),
  })
  .strict();

pushRouter.post(
  '/subscribe',
  requireAuth,
  validate({ body: sub }),
  ah(async (req, res) => {
    const b = req.body;
    // One device belongs to whoever is signed in on it now.
    await pool.query(
      `INSERT INTO ${S}.push_subscriptions (user_id, endpoint, p256dh, auth, language, user_agent) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, language = EXCLUDED.language, user_agent = EXCLUDED.user_agent`,
      [req.auth!.userId, b.endpoint, b.keys.p256dh, b.keys.auth, b.language, String(req.headers['user-agent'] ?? '').slice(0, 200)],
    );
    res.status(201).json({ success: true });
  }),
);

/** Turn off for this device (also called on sign-out). Works signed out too: the endpoint is the secret. */
pushRouter.post(
  '/unsubscribe',
  validate({ body: z.object({ endpoint: z.string().url().max(1000) }).strict() }),
  ah(async (req, res) => {
    await pool.query(`DELETE FROM ${S}.push_subscriptions WHERE endpoint = $1`, [req.body.endpoint]);
    res.json({ success: true });
  }),
);

/** Where tapping it should open (same rules as the app's notification list). */
function linkOf(n: { type: string; body: string | null; metadata: any }): string {
  const m = n.metadata ?? {};
  if (typeof m.link === 'string' && (m.link.startsWith('/app/') || m.link.startsWith('/s/'))) return m.link;
  if (m.conversationId) return `/app/messages/${m.conversationId}`;
  if (n.type === 'new_order' || n.type === 'balance_paid' || n.type === 'order_disputed' || (n.type === 'order_cancelled' && /buyer/i.test(n.body ?? ''))) return '/app/merchant/orders';
  if (n.type === 'dispute_opened') return '/app/admin/disputes';
  if (m.orderId || n.type.startsWith('order_')) return n.type === 'order_paid' ? '/app/merchant/orders' : '/app/orders';
  if (/^(money_|payment_|bank_|voucher_)/.test(n.type)) return '/app/activity';
  if (n.type.startsWith('activity:auth')) return '/app/settings';
  if (n.type.startsWith('activity:bank')) return '/app/bank';
  return '/app';
}

const clip = (s: unknown, n: number) => {
  const t = String(s ?? '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Send what's new. Each notification is claimed once (safe with several server instances). */
export async function dispatchPush() {
  const c = await pool.connect();
  let rows: any[] = [];
  try {
    await c.query('BEGIN');
    const r = await c.query(
      `UPDATE ${S}.notifications SET pushed_at = now()
        WHERE id IN (SELECT id FROM ${S}.notifications WHERE pushed_at IS NULL ORDER BY created_at LIMIT 200 FOR UPDATE SKIP LOCKED)
        RETURNING id, user_id, type, title, body, metadata, created_at`,
    );
    await c.query('COMMIT');
    rows = r.rows;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
  if (!pushEnabled || !rows.length) return;
  // Only fresh ones: a notification from long ago is news to no one.
  const fresh = rows.filter((n) => Date.now() - new Date(n.created_at).getTime() < 10 * 60_000);
  if (!fresh.length) return;
  const subs = await pool.query(`SELECT id, user_id, endpoint, p256dh, auth, language FROM ${S}.push_subscriptions WHERE user_id = ANY($1)`, [
    Array.from(new Set(fresh.map((n) => n.user_id))),
  ]);
  for (const n of fresh) {
    for (const s of subs.rows.filter((x) => String(x.user_id) === String(n.user_id))) {
      const ar = s.language === 'ar' && n.metadata?.ar;
      const payload = JSON.stringify({
        id: n.id,
        type: n.type,
        title: clip(ar ? n.metadata.ar.title : n.title, 90),
        body: clip(ar ? n.metadata.ar.body : n.body, 180),
        link: linkOf(n),
        lang: s.language,
      });
      webpush
        .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60, urgency: 'high', topic: String(n.id).replace(/-/g, '').slice(0, 32) })
        .then(() => pool.query(`UPDATE ${S}.push_subscriptions SET last_ok_at = now() WHERE id = $1`, [s.id]))
        .catch((err: any) => {
          // Gone or unsubscribed in the browser: forget this device.
          if (err?.statusCode === 404 || err?.statusCode === 410) return pool.query(`DELETE FROM ${S}.push_subscriptions WHERE id = $1`, [s.id]);
          logger.warn({ status: err?.statusCode, msg: String(err?.body ?? err?.message ?? '').slice(0, 200) }, 'push failed');
        });
    }
  }
}

export function startPushDispatcher() {
  let busy = false;
  const t = setInterval(() => {
    if (busy) return;
    busy = true;
    dispatchPush()
      .catch((err) => logger.warn({ err }, 'push dispatch failed'))
      .finally(() => {
        busy = false;
      });
  }, 2000);
  t.unref();
  logger.info({ enabled: pushEnabled }, 'device notifications ready');
}

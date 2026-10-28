import { Router } from 'express';
import type pg from 'pg';
import crypto from 'node:crypto';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { env } from '../config/env.js';
import { one, pool, S, tx } from '../lib/db.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { amountSchema, fromCents, toCents } from '../lib/money.js';
import { idempotencyKey, pageQuery, totpCode, validate } from '../lib/validate.js';
import { idempotent } from '../lib/idempotency.js';
import { audit } from '../lib/audit.js';
import { privateDownload, putFile, storageDriver } from '../lib/storage.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { moneyLimiter } from '../middleware/security.js';
import { requireSecondFactor } from './mfa.js';
import { assertDailyLimit, assertMaxTransfer, credit, debit, notify, walletOfUser, writeLine } from './walletCore.js';

/** Ids of legacy rows may be UUIDs or integers. */
export const idParam = z.string().regex(/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|\d{1,18})$/, 'Invalid id');
const like = (q: string) => `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;

// Columns that are safe to show to anyone. digital_file_url is NEVER public
// (the old API leaked it, letting anyone download paid files for free).
const PUBLIC_PRODUCT_COLS = `p.id, p.merchant_id, p.name, p.description, p.price, p.image_url, p.stock, p.is_digital, p.category, p.created_at, m.store_name`;

// =================================================================== escrow
async function merchantWalletId(c: pg.PoolClient, merchantId: string): Promise<{ id: string; wallet_id: string; user_id: string }> {
  const w = await one<any>(
    `SELECT w.id, w.wallet_id, w.user_id FROM ${S}.merchants m
       JOIN ${S}.wallets w ON w.id = m.wallet_id OR (m.wallet_id IS NULL AND w.user_id = m.user_id)
      WHERE m.id = $1 ORDER BY (w.id = m.wallet_id) DESC LIMIT 1`,
    [merchantId],
    c,
  );
  if (!w) throw new AppError(500, 'MERCHANT_WALLET_MISSING', 'Merchant wallet not found');
  return w;
}

/** Pays the merchant for an order held in escrow (exactly once). */
export async function releaseEscrow(c: pg.PoolClient, orderId: string, reason: string) {
  const o = await one<any>(
    `UPDATE ${S}.orders SET escrow_status = 'released', status = 'completed', completed_at = now()
      WHERE id = $1 AND escrow_status = 'held' AND payment_status = 'completed' RETURNING *`,
    [orderId],
    c,
  );
  if (!o) return null;
  const mw = await merchantWalletId(c, o.merchant_id);
  await c.query(`SELECT id FROM ${S}.wallets WHERE id = $1 FOR UPDATE`, [mw.id]);
  const balance = await credit(c, mw.id, o.total_amount);
  await writeLine(c, {
    userId: mw.user_id,
    walletId: mw.wallet_id,
    type: 'sale',
    amount: o.total_amount,
    description: `Order #${String(o.id).slice(0, 8)} — ${reason}`,
    reference: o.checkout_ref ?? undefined,
    metadata: { orderId: o.id },
    balanceAfter: balance,
  });
  await notify(c, mw.user_id, 'order_paid', 'Payment released', `${o.total_amount} ${env.CURRENCY} for order #${String(o.id).slice(0, 8)}`);
  return o;
}

/** Returns the money to the buyer and restocks physical items (exactly once). */
export async function refundOrder(c: pg.PoolClient, orderId: string, by: string) {
  const o = await one<any>(
    `UPDATE ${S}.orders SET escrow_status = 'refunded', status = 'cancelled'
      WHERE id = $1 AND escrow_status = 'held' AND payment_status = 'completed' RETURNING *`,
    [orderId],
    c,
  );
  if (!o) return null;
  const w = await walletOfUser(o.user_id, c, true);
  const balance = await credit(c, w.id, o.total_amount);
  await writeLine(c, {
    userId: o.user_id,
    walletId: w.wallet_id,
    type: 'refund',
    amount: o.total_amount,
    description: `Refund for order #${String(o.id).slice(0, 8)} (${by})`,
    metadata: { orderId: o.id },
    balanceAfter: balance,
  });
  await c.query(
    `UPDATE ${S}.products p SET stock = p.stock + i.quantity FROM ${S}.order_items i
      WHERE i.order_id = $1 AND i.product_id = p.id AND NOT COALESCE(i.is_digital, false)`,
    [o.id],
  );
  await notify(c, o.user_id, 'order_refunded', 'Order refunded', `${o.total_amount} ${env.CURRENCY} returned to your wallet`);
  return o;
}

// ==================================================================== store
export const storeRouter = Router();

storeRouter.get(
  '/products',
  validate({
    query: pageQuery
      .extend({
        q: z.string().trim().max(64).optional(),
        merchant: idParam.optional(),
        category: z.string().trim().max(40).optional(),
        type: z.enum(['digital', 'physical']).optional(),
        sort: z.enum(['new', 'price_asc', 'price_desc', 'name']).default('new'),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const f = req.query as any;
    const params: unknown[] = [];
    const where = [`COALESCE(p.status,'active') = 'active'`, `COALESCE(m.status,'active') = 'active'`];
    if (f.q) {
      params.push(like(f.q));
      where.push(`(p.name ILIKE $${params.length} OR p.description ILIKE $${params.length} OR m.store_name ILIKE $${params.length})`);
    }
    if (f.merchant) {
      params.push(f.merchant);
      where.push(`p.merchant_id = $${params.length}`);
    }
    if (f.category) {
      params.push(f.category);
      where.push(`p.category = $${params.length}`);
    }
    if (f.type) where.push(f.type === 'digital' ? 'p.is_digital' : 'NOT COALESCE(p.is_digital,false)');
    const order = { new: 'p.created_at DESC', price_asc: 'p.price ASC', price_desc: 'p.price DESC', name: 'p.name ASC' }[f.sort as 'new'];
    params.push(f.limit, f.offset);
    const r = await pool.query(
      `SELECT ${PUBLIC_PRODUCT_COLS}, COUNT(*) OVER() AS total FROM ${S}.products p JOIN ${S}.merchants m ON m.id = p.merchant_id
        WHERE ${where.join(' AND ')} ORDER BY ${order}, p.id LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({ success: true, data: { products: r.rows.map(({ total, ...p }) => p), total: Number(r.rows[0]?.total ?? 0) } });
  }),
);

storeRouter.get(
  '/products/:id',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const p = await one(
      `SELECT ${PUBLIC_PRODUCT_COLS}, m.description AS store_description FROM ${S}.products p JOIN ${S}.merchants m ON m.id = p.merchant_id
        WHERE p.id = $1 AND COALESCE(p.status,'active') = 'active'`,
      [req.params.id],
    );
    if (!p) throw notFound('Product not found');
    res.json({ success: true, data: { product: p } });
  }),
);

storeRouter.get(
  '/stores',
  ah(async (_req, res) => {
    const r = await pool.query(
      `SELECT m.id, m.store_name, m.description, m.logo_url, count(p.id)::int AS products
         FROM ${S}.merchants m LEFT JOIN ${S}.products p ON p.merchant_id = m.id AND COALESCE(p.status,'active') = 'active'
        WHERE COALESCE(m.status,'active') = 'active' GROUP BY m.id ORDER BY products DESC, m.store_name LIMIT 100`,
    );
    res.json({ success: true, data: { stores: r.rows } });
  }),
);

const checkoutBody = z
  .object({
    items: z
      .array(z.object({ productId: idParam, quantity: z.number().int().min(1).max(99) }).strict())
      .min(1)
      .max(20),
    totp: totpCode.optional(),
  })
  .strict();

storeRouter.post(
  '/checkout',
  requireAuth,
  moneyLimiter,
  validate({ body: checkoutBody }),
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    const key = req.headers['idempotency-key'] ? idempotencyKey.parse(req.headers['idempotency-key']) : undefined;
    const out = await idempotent(`checkout:${userId}`, key, req.body, async () => {
      await requireSecondFactor(userId, req.body.totp);
      // merge duplicate lines
      const qty = new Map<string, number>();
      for (const i of req.body.items as { productId: string; quantity: number }[]) qty.set(i.productId, (qty.get(i.productId) ?? 0) + i.quantity);
      const checkoutRef = crypto.randomUUID();
      const result = await tx(async (c) => {
        const r = await c.query<any>(
          `SELECT p.id, p.merchant_id, p.name, p.price, p.stock, p.is_digital, p.digital_file_url, COALESCE(p.status,'active') AS status,
                  m.user_id AS merchant_user_id, COALESCE(m.status,'active') AS merchant_status
             FROM ${S}.products p JOIN ${S}.merchants m ON m.id = p.merchant_id
            WHERE p.id = ANY($1) ORDER BY p.id FOR UPDATE OF p`,
          [Array.from(qty.keys())],
        );
        if (r.rowCount !== qty.size) throw notFound('One of the products no longer exists', 'PRODUCT_NOT_FOUND');
        const groups = new Map<string, { cents: bigint; lines: any[]; digitalOnly: boolean }>();
        for (const p of r.rows) {
          const q = qty.get(String(p.id))!;
          if (p.status !== 'active' || p.merchant_status !== 'active') throw conflict('PRODUCT_UNAVAILABLE', `${p.name} is not available`);
          if (String(p.merchant_user_id) === String(userId)) throw badRequest('OWN_PRODUCT', 'You cannot buy your own product');
          if (p.is_digital && q !== 1) throw badRequest('DIGITAL_QUANTITY', `${p.name} is digital — quantity must be 1`);
          if (!p.is_digital && Number(p.stock) < q) throw conflict('OUT_OF_STOCK', `Only ${p.stock} left of ${p.name}`);
          const g = groups.get(String(p.merchant_id)) ?? { cents: 0n, lines: [], digitalOnly: true };
          g.cents += toCents(p.price) * BigInt(q);
          g.lines.push({ ...p, quantity: q });
          g.digitalOnly &&= Boolean(p.is_digital);
          groups.set(String(p.merchant_id), g);
        }
        const total = fromCents(Array.from(groups.values()).reduce((s, g) => s + g.cents, 0n));
        assertMaxTransfer(total);
        const w = await walletOfUser(userId, c, true);
        await assertDailyLimit(c, w.wallet_id, total);
        const balance = await debit(c, w.id, total);
        await writeLine(c, {
          userId,
          walletId: w.wallet_id,
          type: 'purchase',
          amount: `-${total}`,
          description: `Marketplace purchase (${qty.size} item${qty.size > 1 ? 's' : ''})`,
          reference: checkoutRef,
          balanceAfter: balance,
        });
        const orders: any[] = [];
        for (const [merchantId, g] of groups) {
          const order = await one<any>(
            `INSERT INTO ${S}.orders (user_id, merchant_id, total_amount, status, payment_status, paid_at, escrow_status, checkout_ref)
             VALUES ($1, $2, $3, 'processing', 'completed', now(), 'held', $4) RETURNING id, total_amount, status`,
            [userId, merchantId, fromCents(g.cents), checkoutRef],
            c,
          );
          for (const l of g.lines) {
            await c.query(
              `INSERT INTO ${S}.order_items (order_id, product_id, quantity, price, is_digital, digital_file_url, product_name) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [order.id, l.id, l.quantity, l.price, Boolean(l.is_digital), l.is_digital ? l.digital_file_url : null, l.name],
            );
            if (!l.is_digital) {
              const s = await c.query(`UPDATE ${S}.products SET stock = stock - $2 WHERE id = $1 AND stock >= $2`, [l.id, l.quantity]);
              if (s.rowCount === 0) throw conflict('OUT_OF_STOCK', `${l.name} just sold out`);
            }
          }
          if (g.digitalOnly) await releaseEscrow(c, order.id, 'digital delivery');
          else await notify(c, g.lines[0].merchant_user_id, 'new_order', 'New order', `Order #${String(order.id).slice(0, 8)} — ${fromCents(g.cents)} ${env.CURRENCY}`);
          orders.push({ ...order, status: g.digitalOnly ? 'completed' : 'processing' });
        }
        return { total, balance, orders, checkoutRef };
      });
      await audit({ userId, action: 'store.checkout', entityType: 'checkout', entityId: result.checkoutRef, details: { total: result.total } }, req);
      return { status: 201, body: { success: true, data: result } };
    });
    res.status(out.status).json(out.body);
  }),
);

async function ordersWithItems(where: string, params: unknown[]) {
  const r = await pool.query(
    `SELECT o.id, o.user_id, o.merchant_id, o.total_amount, o.status, o.payment_status, o.escrow_status, o.created_at, o.paid_at, o.shipped_at,
            o.completed_at, m.store_name, u.full_name AS buyer_name,
            COALESCE(json_agg(json_build_object('id', i.id, 'product_id', i.product_id, 'quantity', i.quantity, 'price', i.price,
                     'is_digital', i.is_digital, 'name', COALESCE(i.product_name, p.name), 'image_url', p.image_url))
                     FILTER (WHERE i.id IS NOT NULL), '[]') AS items
       FROM ${S}.orders o
       LEFT JOIN ${S}.merchants m ON m.id = o.merchant_id
       LEFT JOIN ${S}.users u ON u.id = o.user_id
       LEFT JOIN ${S}.order_items i ON i.order_id = o.id
       LEFT JOIN ${S}.products p ON p.id = i.product_id
      WHERE ${where} GROUP BY o.id, m.store_name, u.full_name ORDER BY o.created_at DESC LIMIT 100`,
    params,
  );
  return r.rows;
}

storeRouter.get(
  '/orders',
  requireAuth,
  ah(async (req, res) => {
    res.json({ success: true, data: { orders: await ordersWithItems('o.user_id = $1', [req.auth!.userId]) } });
  }),
);

storeRouter.get(
  '/orders/:id',
  requireAuth,
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const [o] = await ordersWithItems('o.id = $1 AND o.user_id = $2', [req.params.id, req.auth!.userId]);
    if (!o) throw notFound('Order not found');
    res.json({ success: true, data: { order: o } });
  }),
);

storeRouter.post(
  '/orders/:id/cancel',
  requireAuth,
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const done = await tx(async (c) => {
      const o = await one<any>(`SELECT id, status FROM ${S}.orders WHERE id = $1 AND user_id = $2 FOR UPDATE`, [req.params.id, req.auth!.userId], c);
      if (!o) throw notFound('Order not found');
      if (o.status !== 'processing') throw conflict('CANNOT_CANCEL', 'Only orders that have not shipped can be cancelled');
      return refundOrder(c, o.id, 'cancelled by buyer');
    });
    if (!done) throw conflict('CANNOT_CANCEL', 'This order cannot be cancelled');
    res.json({ success: true });
  }),
);

storeRouter.post(
  '/orders/:id/confirm',
  requireAuth,
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const done = await tx(async (c) => {
      const o = await one<any>(`SELECT id, status FROM ${S}.orders WHERE id = $1 AND user_id = $2 FOR UPDATE`, [req.params.id, req.auth!.userId], c);
      if (!o) throw notFound('Order not found');
      if (!['processing', 'shipped'].includes(o.status)) throw conflict('CANNOT_CONFIRM', 'This order is already closed');
      return releaseEscrow(c, o.id, 'received by buyer');
    });
    if (!done) throw conflict('CANNOT_CONFIRM', 'This order is already closed');
    res.json({ success: true });
  }),
);

storeRouter.get(
  '/orders/:orderId/items/:itemId/download',
  requireAuth,
  validate({ params: z.object({ orderId: idParam, itemId: idParam }).strict() }),
  ah(async (req, res) => {
    const item = await one<any>(
      `SELECT i.digital_file_url, COALESCE(i.product_name, p.name) AS name, o.payment_status, o.status
         FROM ${S}.order_items i JOIN ${S}.orders o ON o.id = i.order_id LEFT JOIN ${S}.products p ON p.id = i.product_id
        WHERE i.id = $1 AND o.id = $2 AND o.user_id = $3 AND i.is_digital`,
      [req.params.itemId, req.params.orderId, req.auth!.userId],
    );
    if (!item || item.payment_status !== 'completed' || item.status === 'cancelled' || !item.digital_file_url) throw notFound('Download not available');
    const d = await privateDownload(item.digital_file_url);
    if (!d) throw notFound('File not found');
    if (d.redirect) return res.json({ success: true, data: { url: d.redirect, expiresIn: 300 } });
    const safe = item.name.replace(/[^\p{L}\p{N} ._-]/gu, '_').slice(0, 80) || 'download';
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safe + '.' + (d.file!.filename.split('.').pop() ?? 'bin'))}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(d.file!.data);
  }),
);

// ================================================================= merchant
export const merchantRouter = Router();
merchantRouter.use(requireAuth, requireRole('merchant'));

async function myMerchant(userId: string, c?: pg.PoolClient) {
  const m = await one<any>(`SELECT * FROM ${S}.merchants WHERE user_id = $1 ORDER BY created_at ASC NULLS LAST LIMIT 1`, [userId], c);
  if (!m) throw notFound('Create your store profile first', 'NO_STORE');
  return m;
}

const storeBody = z
  .object({ storeName: z.string().trim().min(2).max(60), description: z.string().trim().max(500).optional().default(''), logoUrl: z.string().max(500).optional() })
  .strict();

merchantRouter.get(
  '/profile',
  ah(async (req, res) => {
    const m = await one(`SELECT id, store_name, description, logo_url, status, created_at FROM ${S}.merchants WHERE user_id = $1 ORDER BY created_at LIMIT 1`, [
      req.auth!.userId,
    ]);
    res.json({ success: true, data: { merchant: m } });
  }),
);

merchantRouter.post(
  '/profile',
  validate({ body: storeBody }),
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    if (await one(`SELECT 1 FROM ${S}.merchants WHERE user_id = $1`, [userId])) throw conflict('STORE_EXISTS', 'You already have a store');
    const w = await walletOfUser(userId);
    const m = await one(
      `INSERT INTO ${S}.merchants (user_id, store_name, description, wallet_id, status, logo_url) VALUES ($1, $2, $3, $4, 'active', $5)
       RETURNING id, store_name, description, logo_url, status, created_at`,
      [userId, req.body.storeName, req.body.description, w.id, req.body.logoUrl ?? null],
    );
    res.status(201).json({ success: true, data: { merchant: m } });
  }),
);

merchantRouter.patch(
  '/profile',
  validate({ body: storeBody.partial().strict() }),
  ah(async (req, res) => {
    const m = await myMerchant(req.auth!.userId);
    await pool.query(
      `UPDATE ${S}.merchants SET store_name = COALESCE($2, store_name), description = COALESCE($3, description), logo_url = COALESCE($4, logo_url) WHERE id = $1`,
      [m.id, req.body.storeName ?? null, req.body.description ?? null, req.body.logoUrl ?? null],
    );
    res.json({ success: true });
  }),
);

merchantRouter.get(
  '/stats',
  ah(async (req, res) => {
    const m = await myMerchant(req.auth!.userId);
    const s = await one(
      `SELECT COALESCE(SUM(total_amount) FILTER (WHERE escrow_status = 'released'), 0)::text AS revenue,
              COALESCE(SUM(total_amount) FILTER (WHERE escrow_status = 'held'), 0)::text AS in_escrow,
              count(*) FILTER (WHERE status = 'processing')::int AS to_ship,
              count(*) FILTER (WHERE status = 'shipped')::int AS shipped,
              count(*) FILTER (WHERE status = 'completed')::int AS completed,
              count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
         FROM ${S}.orders WHERE merchant_id = $1`,
      [m.id],
    );
    const series = await pool.query(
      `WITH days AS (SELECT generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') AS d)
       SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(SUM(o.total_amount), 0)::text AS sales, count(o.id)::int AS orders
         FROM days LEFT JOIN ${S}.orders o ON date_trunc('day', o.created_at) = days.d AND o.merchant_id = $1 AND o.status <> 'cancelled'
        GROUP BY d ORDER BY d`,
      [m.id],
    );
    const top = await pool.query(
      `SELECT COALESCE(i.product_name, p.name) AS name, SUM(i.quantity)::int AS sold, SUM(i.price * i.quantity)::text AS revenue
         FROM ${S}.order_items i JOIN ${S}.orders o ON o.id = i.order_id LEFT JOIN ${S}.products p ON p.id = i.product_id
        WHERE o.merchant_id = $1 AND o.status <> 'cancelled' GROUP BY 1 ORDER BY sold DESC LIMIT 5`,
      [m.id],
    );
    res.json({ success: true, data: { stats: s, series: series.rows, topProducts: top.rows } });
  }),
);

const productBody = z
  .object({
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(2000).optional().default(''),
    price: amountSchema,
    stock: z.number().int().min(0).max(1_000_000).default(0),
    category: z.string().trim().max(40).optional(),
    imageUrl: z
      .string()
      .max(500)
      .refine((u) => u.startsWith('/files/') || /^https:\/\/[a-z0-9.-]+\.supabase\.co\/storage\//i.test(u), 'Upload the image first')
      .optional()
      .nullable(),
    isDigital: z.boolean().default(false),
    digitalFileRef: z.string().max(500).optional().nullable(),
  })
  .strict();

merchantRouter.get(
  '/products',
  ah(async (req, res) => {
    const m = await myMerchant(req.auth!.userId);
    const r = await pool.query(
      `SELECT id, name, description, price, image_url, stock, is_digital, category, COALESCE(status,'active') AS status, created_at,
              (digital_file_url IS NOT NULL) AS has_file
         FROM ${S}.products WHERE merchant_id = $1 AND COALESCE(status,'active') <> 'deleted' ORDER BY created_at DESC`,
      [m.id],
    );
    res.json({ success: true, data: { products: r.rows } });
  }),
);

merchantRouter.post(
  '/products',
  validate({ body: productBody }),
  ah(async (req, res) => {
    const m = await myMerchant(req.auth!.userId);
    const b = req.body;
    if (b.isDigital && !b.digitalFileRef) throw badRequest('FILE_REQUIRED', 'Upload the digital file first');
    if (b.digitalFileRef) await assertOwnFileRef(req.auth!.userId, b.digitalFileRef);
    const p = await one(
      `INSERT INTO ${S}.products (merchant_id, name, description, price, image_url, stock, is_digital, digital_file_url, category, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active') RETURNING id, name, price, stock, is_digital, image_url, category, status`,
      [m.id, b.name, b.description, b.price, b.imageUrl ?? null, b.isDigital ? 0 : b.stock, b.isDigital, b.isDigital ? b.digitalFileRef : null, b.category ?? null],
    );
    res.status(201).json({ success: true, data: { product: p } });
  }),
);

merchantRouter.put(
  '/products/:id',
  validate({ params: z.object({ id: idParam }).strict(), body: productBody.extend({ status: z.enum(['active', 'hidden']).optional() }).strict() }),
  ah(async (req, res) => {
    const m = await myMerchant(req.auth!.userId);
    const b = req.body;
    if (b.digitalFileRef) await assertOwnFileRef(req.auth!.userId, b.digitalFileRef);
    const r = await pool.query(
      `UPDATE ${S}.products SET name = $3, description = $4, price = $5, image_url = $6, stock = $7, is_digital = $8,
              digital_file_url = COALESCE($9, digital_file_url), category = $10, status = COALESCE($11, status), updated_at = now()
        WHERE id = $1 AND merchant_id = $2 AND COALESCE(status,'active') <> 'deleted'`,
      [req.params.id, m.id, b.name, b.description, b.price, b.imageUrl ?? null, b.isDigital ? 0 : b.stock, b.isDigital, b.digitalFileRef ?? null, b.category ?? null, b.status ?? null],
    );
    // Same 404 for "not yours" and "missing" — no product enumeration across stores.
    if (r.rowCount === 0) throw notFound('Product not found');
    res.json({ success: true });
  }),
);

merchantRouter.delete(
  '/products/:id',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const m = await myMerchant(req.auth!.userId);
    const r = await pool.query(`UPDATE ${S}.products SET status = 'deleted', updated_at = now() WHERE id = $1 AND merchant_id = $2`, [req.params.id, m.id]);
    if (r.rowCount === 0) throw notFound('Product not found');
    res.json({ success: true });
  }),
);

async function assertOwnFileRef(userId: string, ref: string) {
  if (ref.startsWith('db:')) {
    const f = await one(`SELECT 1 FROM ${S}.stored_files WHERE id = $1 AND owner_id = $2 AND bucket = 'digital-products'`, [ref.slice(3), userId]);
    if (!f) throw forbidden('Unknown file', 'FILE_NOT_OWNED');
  } else if (!ref.startsWith(`${userId}/`)) {
    throw forbidden('Unknown file', 'FILE_NOT_OWNED');
  }
}

const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const digitalLimit = storageDriver === 'supabase' ? 50 * 1024 * 1024 : 20 * 1024 * 1024;
const digitalUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: digitalLimit, files: 1 } });
const BLOCKED_EXT = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|jar|sh|app|dmg|pkg|apk|dll|so|elf|bin|run|hta|lnk|reg)$/i;
const BLOCKED_MIME = new Set([
  'application/x-msdownload', 'application/x-msi', 'application/x-elf', 'application/x-mach-binary', 'application/x-executable',
  'application/vnd.microsoft.portable-executable', 'application/x-sharedlib', 'application/java-archive', 'application/vnd.android.package-archive',
]);

merchantRouter.post(
  '/uploads/image',
  imageUpload.single('image'),
  ah(async (req, res) => {
    if (!req.file) throw badRequest('NO_FILE', 'Choose an image');
    const t = await fileTypeFromBuffer(req.file.buffer);
    if (!t || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(t.mime)) throw badRequest('INVALID_IMAGE', 'Only JPEG, PNG, WebP or GIF');
    const stored = await putFile('product-images', req.auth!.userId, t.ext, t.mime, req.file.buffer, req.file.originalname);
    res.status(201).json({ success: true, data: { url: stored.url } });
  }),
);

merchantRouter.post(
  '/uploads/digital',
  digitalUpload.single('file'),
  ah(async (req, res) => {
    if (!req.file) throw badRequest('NO_FILE', 'Choose a file');
    const t = await fileTypeFromBuffer(req.file.buffer);
    if (BLOCKED_EXT.test(req.file.originalname) || (t && BLOCKED_MIME.has(t.mime)) || req.file.buffer.subarray(0, 2).toString() === 'MZ') {
      throw badRequest('FILE_TYPE_BLOCKED', 'Executable files are not allowed');
    }
    const ext = (t?.ext ?? req.file.originalname.split('.').pop() ?? 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
    const stored = await putFile('digital-products', req.auth!.userId, ext, t?.mime ?? 'application/octet-stream', req.file.buffer, req.file.originalname);
    res.status(201).json({ success: true, data: { ref: stored.ref, name: req.file.originalname, size: req.file.size } });
  }),
);

merchantRouter.get(
  '/orders',
  ah(async (req, res) => {
    const m = await myMerchant(req.auth!.userId);
    const orders = await ordersWithItems('o.merchant_id = $1', [m.id]);
    res.json({ success: true, data: { orders: orders.map(({ user_id, ...o }) => o) } });
  }),
);

merchantRouter.post(
  '/orders/:id/ship',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const m = await myMerchant(req.auth!.userId);
    const r = await one<any>(
      `UPDATE ${S}.orders SET status = 'shipped', shipped_at = now() WHERE id = $1 AND merchant_id = $2 AND status = 'processing' RETURNING user_id, id`,
      [req.params.id, m.id],
    );
    if (!r) throw conflict('CANNOT_SHIP', 'Only paid, unshipped orders can be marked as shipped');
    await notify(undefined, r.user_id, 'order_shipped', 'Order shipped', `Order #${String(r.id).slice(0, 8)} is on its way. Confirm when you receive it.`);
    res.json({ success: true });
  }),
);

merchantRouter.post(
  '/orders/:id/cancel',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const m = await myMerchant(req.auth!.userId);
    const done = await tx(async (c) => {
      const o = await one<any>(`SELECT id FROM ${S}.orders WHERE id = $1 AND merchant_id = $2 FOR UPDATE`, [req.params.id, m.id], c);
      if (!o) throw notFound('Order not found');
      return refundOrder(c, o.id, 'cancelled by store');
    });
    if (!done) throw conflict('CANNOT_CANCEL', 'This order can no longer be cancelled');
    await audit({ userId: req.auth!.userId, action: 'merchant.order_cancelled', entityType: 'order', entityId: req.params.id }, req);
    res.json({ success: true });
  }),
);


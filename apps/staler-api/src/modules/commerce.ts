import { Router, type Request } from 'express';
import type pg from 'pg';
import crypto from 'node:crypto';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { env } from '../config/env.js';
import { one, pool, S, tx } from '../lib/db.js';
import { AppError, badRequest, conflict, forbidden, notFound, tooMany } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { amountSchema, fromCents, toCents } from '../lib/money.js';
import { idempotencyKey, pageQuery, totpCode, validate } from '../lib/validate.js';
import { idempotent } from '../lib/idempotency.js';
import { audit } from '../lib/audit.js';
import { sha256 } from '../lib/crypto.js';
import { clientIp } from '../lib/http.js';
import { privateDownload, putFile, storageDriver } from '../lib/storage.js';
import { personalise } from '../lib/watermark.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { moneyLimiter } from '../middleware/security.js';
import { requireSecondFactor } from './mfa.js';
import { assertDailyLimit, assertMaxTransfer, credit, debit, notifyBi, walletOfUser, writeLine } from './walletCore.js';

/** Ids of legacy rows may be UUIDs or integers. */
export const idParam = z.string().regex(/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|\d{1,18})$/, 'Invalid id');
const like = (q: string) => `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
const short = (id: string) => String(id).slice(0, 8);
const money = (v: string | number) => `${v} ${env.CURRENCY}`;

export const STORE_CATEGORIES = ['food', 'fashion', 'electronics', 'books', 'beauty', 'home', 'crafts', 'digital', 'services', 'other'] as const;

// Columns that are safe to show to anyone. digital_file_url is NEVER public.
const PUBLIC_PRODUCT_COLS = `p.id, p.merchant_id, p.name, p.description, p.price, p.compare_at_price, p.image_url, p.stock, p.is_digital, p.digital_mode,
  p.category, p.deposit_percent, p.deposit_refundable, p.created_at, m.store_name, m.slug AS store_slug, m.branch_name, m.logo_url AS store_logo`;

const ACTIVE = (a: string) => `COALESCE(${a}.status,'active') = 'active'`;

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

export async function addEvent(c: pg.PoolClient | undefined, orderId: string, kind: string, actor: 'buyer' | 'merchant' | 'system' | 'admin', o: { note?: string | null; lat?: number | null; lng?: number | null } = {}) {
  await one(`INSERT INTO ${S}.order_events (order_id, kind, actor, note, lat, lng) VALUES ($1, $2, $3, $4, $5, $6)`, [
    orderId,
    kind,
    actor,
    o.note ?? null,
    o.lat ?? null,
    o.lng ?? null,
  ], c);
}

/** Pays the merchant everything held for an order (exactly once). */
export async function releaseEscrow(c: pg.PoolClient, orderId: string, reason: string, actor: 'buyer' | 'merchant' | 'system' | 'admin' = 'system') {
  const o = await one<any>(
    `UPDATE ${S}.orders SET escrow_status = 'released', status = 'completed', completed_at = now(), updated_at = now()
      WHERE id = $1 AND escrow_status = 'held' AND payment_status = 'completed' RETURNING *`,
    [orderId],
    c,
  );
  if (!o) return null;
  const paid = String(o.amount_paid ?? o.total_amount);
  const mw = await merchantWalletId(c, o.merchant_id);
  await c.query(`SELECT id FROM ${S}.wallets WHERE id = $1 FOR UPDATE`, [mw.id]);
  const balance = await credit(c, mw.id, paid);
  await writeLine(c, {
    userId: mw.user_id,
    walletId: mw.wallet_id,
    type: 'sale',
    amount: paid,
    description: `Order #${short(o.id)} — ${reason}`,
    reference: o.checkout_ref ?? undefined,
    metadata: { orderId: o.id },
    balanceAfter: balance,
  });
  await addEvent(c, o.id, 'released', actor, { note: reason });
  await notifyBi(c, mw.user_id, 'order_paid', ['Payment released', `${money(paid)} for order #${short(o.id)}`], ['وصلتك دفعة الطلب', `${money(paid)} للطلب #${short(o.id)}`], {
    orderId: o.id,
  });
  return o;
}

/**
 * Closes an order and gives the money back to the buyer (exactly once).
 * keepDeposit: the buyer walked away from a non-refundable deposit — that part goes to the store.
 */
export async function refundOrder(c: pg.PoolClient, orderId: string, by: string, opts: { keepDeposit?: boolean; actor?: 'buyer' | 'merchant' | 'system' | 'admin' } = {}) {
  const o = await one<any>(
    `UPDATE ${S}.orders SET escrow_status = 'refunded', status = 'cancelled', cancel_reason = $2, updated_at = now()
      WHERE id = $1 AND escrow_status = 'held' AND payment_status = 'completed' RETURNING *`,
    [orderId, by],
    c,
  );
  if (!o) return null;
  const paid = toCents(String(o.amount_paid ?? o.total_amount));
  const keep = opts.keepDeposit ? paid : 0n;
  const back = paid - keep;
  if (back > 0n) {
    const w = await walletOfUser(o.user_id, c, true);
    const balance = await credit(c, w.id, fromCents(back));
    await writeLine(c, {
      userId: o.user_id,
      walletId: w.wallet_id,
      type: 'refund',
      amount: fromCents(back),
      description: `Refund for order #${short(o.id)} (${by})`,
      metadata: { orderId: o.id },
      balanceAfter: balance,
    });
    await notifyBi(c, o.user_id, 'order_refunded', ['Order refunded', `${money(fromCents(back))} returned to your wallet`], ['رجعتلك مصاري الطلب', `رجع ${money(fromCents(back))} لمحفظتك`], {
      orderId: o.id,
    });
  }
  if (keep > 0n) {
    const mw = await merchantWalletId(c, o.merchant_id);
    const balance = await credit(c, mw.id, fromCents(keep));
    await writeLine(c, {
      userId: mw.user_id,
      walletId: mw.wallet_id,
      type: 'sale',
      amount: fromCents(keep),
      description: `Deposit kept — order #${short(o.id)} cancelled by buyer`,
      metadata: { orderId: o.id },
      balanceAfter: balance,
    });
  }
  await c.query(
    `UPDATE ${S}.products p SET stock = p.stock + i.quantity FROM ${S}.order_items i
      WHERE i.order_id = $1 AND i.product_id = p.id AND NOT COALESCE(i.is_digital, false)`,
    [o.id],
  );
  await addEvent(c, o.id, 'cancelled', opts.actor ?? 'system', { note: by });
  return o;
}

// ==================================================================== store
export const storeRouter = Router();

storeRouter.get(
  '/categories',
  ah(async (_req, res) => {
    res.json({ success: true, data: { categories: STORE_CATEGORIES } });
  }),
);

storeRouter.get(
  '/products',
  validate({
    query: pageQuery
      .extend({
        q: z.string().trim().max(64).optional(),
        merchant: idParam.optional(),
        store: z.string().trim().max(80).optional(),
        category: z.string().trim().max(40).optional(),
        storeCategory: z.enum(STORE_CATEGORIES).optional(),
        type: z.enum(['digital', 'physical', 'deposit', 'deals']).optional(),
        sort: z.enum(['new', 'price_asc', 'price_desc', 'name']).default('new'),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const f = req.query as any;
    const params: unknown[] = [];
    const where = [ACTIVE('p'), ACTIVE('m')];
    if (f.q) {
      params.push(like(f.q));
      where.push(`(p.name ILIKE $${params.length} OR p.description ILIKE $${params.length} OR m.store_name ILIKE $${params.length})`);
    }
    if (f.merchant) {
      params.push(f.merchant);
      where.push(`p.merchant_id = $${params.length}`);
    }
    if (f.store) {
      params.push(f.store);
      where.push(`m.slug = $${params.length}`);
    }
    if (f.category) {
      params.push(f.category);
      where.push(`p.category = $${params.length}`);
    }
    if (f.storeCategory) {
      params.push(f.storeCategory);
      where.push(`COALESCE((SELECT pm.category FROM ${S}.merchants pm WHERE pm.id = m.parent_id), m.category, 'other') = $${params.length}`);
    }
    if (f.type === 'deals') where.push('p.compare_at_price IS NOT NULL AND p.compare_at_price > p.price');
    else if (f.type === 'deposit') where.push('p.deposit_percent > 0 AND NOT COALESCE(p.is_digital,false)');
    else if (f.type) where.push(f.type === 'digital' ? 'p.is_digital' : 'NOT COALESCE(p.is_digital,false)');
    const order = { new: 'p.created_at DESC', price_asc: 'p.price ASC', price_desc: 'p.price DESC', name: 'p.name ASC' }[f.sort as 'new'];
    params.push(f.limit, f.offset);
    const r = await pool.query(
      `SELECT ${PUBLIC_PRODUCT_COLS}, COUNT(*) OVER() AS total FROM ${S}.products p JOIN ${S}.merchants m ON m.id = p.merchant_id
        WHERE ${where.join(' AND ')} ORDER BY (COALESCE(p.is_digital,false) OR p.stock > 0) DESC, ${order}, p.id LIMIT $${params.length - 1} OFFSET $${params.length}`,
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
        WHERE p.id = $1 AND ${ACTIVE('p')}`,
      [req.params.id],
    );
    if (!p) throw notFound('Product not found');
    res.json({ success: true, data: { product: p } });
  }),
);

/** Store directory: main stores with owner, category, city, counts. */
storeRouter.get(
  '/stores',
  validate({ query: z.object({ q: z.string().trim().max(64).optional(), category: z.string().trim().max(40).optional() }).strict() }),
  ah(async (req, res) => {
    const params: unknown[] = [];
    const where = [ACTIVE('m'), 'm.parent_id IS NULL'];
    if (req.query.q) {
      params.push(like(String(req.query.q)));
      where.push(`(m.store_name ILIKE $${params.length} OR m.description ILIKE $${params.length} OR u.full_name ILIKE $${params.length} OR m.city ILIKE $${params.length})`);
    }
    if (req.query.category) {
      params.push(req.query.category);
      where.push(`m.category = $${params.length}`);
    }
    const r = await pool.query(
      `SELECT m.id, m.slug, m.store_name, m.description, m.logo_url, m.cover_url, m.category, m.city, m.accent, u.full_name AS owner_name,
              (SELECT count(*)::int FROM ${S}.products p JOIN ${S}.merchants b ON b.id = p.merchant_id
                WHERE (b.id = m.id OR b.parent_id = m.id) AND ${ACTIVE('p')} AND ${ACTIVE('b')}) AS products,
              (SELECT count(*)::int FROM ${S}.merchants b WHERE b.parent_id = m.id AND ${ACTIVE('b')}) AS branches,
              (SELECT count(*)::int FROM ${S}.store_ads a WHERE a.merchant_id = m.id AND a.active AND (a.ends_at IS NULL OR a.ends_at > now())) AS ads
         FROM ${S}.merchants m JOIN ${S}.users u ON u.id = m.user_id
        WHERE ${where.join(' AND ')} AND u.status = 'active'
        ORDER BY products DESC, m.store_name LIMIT 200`,
      params,
    );
    res.json({ success: true, data: { stores: r.rows } });
  }),
);

/** One store page: details, branches, owner, ads. Branch slugs work too. */
storeRouter.get(
  '/s/:slug',
  validate({ params: z.object({ slug: z.string().trim().min(2).max(80) }).strict() }),
  ah(async (req, res) => {
    const m = await one<any>(
      `SELECT m.*, u.full_name AS owner_name FROM ${S}.merchants m JOIN ${S}.users u ON u.id = m.user_id
        WHERE m.slug = $1 AND ${ACTIVE('m')} AND u.status = 'active'`,
      [req.params.slug],
    );
    if (!m) throw notFound('Store not found', 'STORE_NOT_FOUND');
    const mainId = m.parent_id ?? m.id;
    const main = m.parent_id ? await one<any>(`SELECT * FROM ${S}.merchants WHERE id = $1`, [mainId]) : m;
    const branches = await pool.query(
      `SELECT id, slug, store_name, branch_name, city, address, lat, lng, (parent_id IS NULL) AS is_main
         FROM ${S}.merchants WHERE (id = $1 OR parent_id = $1) AND ${ACTIVE('merchants')} ORDER BY parent_id NULLS FIRST, created_at`,
      [mainId],
    );
    const ads = await pool.query(
      `SELECT id, kind, media_url, title, body, product_id FROM ${S}.store_ads
        WHERE merchant_id = ANY($1) AND active AND (ends_at IS NULL OR ends_at > now()) ORDER BY sort, created_at DESC LIMIT 12`,
      [branches.rows.map((b) => b.id)],
    );
    const pub = (x: any) => ({
      id: x.id,
      slug: x.slug,
      store_name: x.store_name,
      branch_name: x.branch_name,
      description: x.description,
      logo_url: x.logo_url,
      cover_url: x.cover_url,
      category: x.category,
      city: x.city,
      address: x.address,
      lat: x.lat,
      lng: x.lng,
      accent: x.accent,
      delivery_note: x.delivery_note,
      offers_pickup: x.offers_pickup,
      offers_delivery: x.offers_delivery,
      phone: x.show_phone ? x.phone : null,
      instagram: x.instagram ?? null,
      tiktok: x.tiktok ?? null,
      facebook: x.facebook ?? null,
    });
    res.json({
      success: true,
      data: {
        store: { ...pub(m), owner_name: m.owner_name, main: pub(main) },
        branches: branches.rows,
        ads: ads.rows,
        pickupPoints: (
          await pool.query(
            `SELECT id, merchant_id, name, description, city, address, hours, lat, lng FROM ${S}.pickup_points WHERE merchant_id = ANY($1) AND active ORDER BY sort, created_at`,
            [branches.rows.map((x) => x.id)],
          )
        ).rows,
      },
    });
  }),
);

// ----------------------------------------------------------------- checkout
const checkoutBody = z
  .object({
    items: z
      .array(z.object({ productId: idParam, quantity: z.number().int().min(1).max(99) }).strict())
      .min(1)
      .max(20),
    totp: totpCode.optional(),
    fulfillment: z.enum(['delivery', 'pickup']).default('delivery'),
    address: z.string().trim().max(300).optional(),
    phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    note: z.string().trim().max(300).optional(),
    /** Chosen pickup point per store (only for stores that list pickup points). */
    pickupPoints: z.record(idParam, idParam).optional(),
  })
  .strict();

const handoverCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
const licenceCode = () => `ST-${crypto.randomBytes(4).toString('hex').toUpperCase().replace(/(.{4})/, '$1-')}`;

storeRouter.post(
  '/checkout',
  requireAuth,
  moneyLimiter,
  validate({ body: checkoutBody }),
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    const b = req.body as z.infer<typeof checkoutBody>;
    const key = req.headers['idempotency-key'] ? idempotencyKey.parse(req.headers['idempotency-key']) : undefined;
    const out = await idempotent(`checkout:${userId}`, key, req.body, async () => {
      await requireSecondFactor(userId, b.totp);
      const qty = new Map<string, number>();
      for (const i of b.items) qty.set(i.productId, (qty.get(i.productId) ?? 0) + i.quantity);
      const checkoutRef = crypto.randomUUID();
      const result = await tx(async (c) => {
        const r = await c.query<any>(
          `SELECT p.id, p.merchant_id, p.name, p.price, p.stock, p.is_digital, p.digital_file_url, p.deposit_percent, p.deposit_refundable,
                  COALESCE(p.status,'active') AS status, m.user_id AS merchant_user_id, COALESCE(m.status,'active') AS merchant_status,
                  m.offers_pickup, m.offers_delivery
             FROM ${S}.products p JOIN ${S}.merchants m ON m.id = p.merchant_id
            WHERE p.id = ANY($1) ORDER BY p.id FOR UPDATE OF p`,
          [Array.from(qty.keys())],
        );
        if (r.rowCount !== qty.size) throw notFound('One of the products no longer exists', 'PRODUCT_NOT_FOUND');
        type G = { full: bigint; now: bigint; lines: any[]; digitalOnly: boolean; depositRefundable: boolean; merchantUser: string };
        const groups = new Map<string, G>();
        for (const p of r.rows) {
          const q = qty.get(String(p.id))!;
          if (p.status !== 'active' || p.merchant_status !== 'active') throw conflict('PRODUCT_UNAVAILABLE', `${p.name} is not available`);
          if (String(p.merchant_user_id) === String(userId)) throw badRequest('OWN_PRODUCT', 'You cannot buy your own product');
          if (p.is_digital && q !== 1) throw badRequest('DIGITAL_QUANTITY', `${p.name} is digital — quantity must be 1`);
          if (!p.is_digital && Number(p.stock) < q) throw conflict('OUT_OF_STOCK', `Only ${p.stock} left of ${p.name}`);
          if (!p.is_digital && b.fulfillment === 'pickup' && p.offers_pickup === false) throw badRequest('NO_PICKUP', 'This store does not offer pickup');
          if (!p.is_digital && b.fulfillment === 'delivery' && p.offers_delivery === false) throw badRequest('NO_DELIVERY', 'This store does not deliver');
          const g: G = groups.get(String(p.merchant_id)) ?? { full: 0n, now: 0n, lines: [], digitalOnly: true, depositRefundable: true, merchantUser: p.merchant_user_id };
          const line = toCents(p.price) * BigInt(q);
          const dep = !p.is_digital && Number(p.deposit_percent) > 0 ? (line * BigInt(p.deposit_percent) + 99n) / 100n : line;
          g.full += line;
          g.now += dep;
          g.lines.push({ ...p, quantity: q });
          g.digitalOnly &&= Boolean(p.is_digital);
          if (!p.is_digital && Number(p.deposit_percent) > 0 && !p.deposit_refundable) g.depositRefundable = false;
          groups.set(String(p.merchant_id), g);
        }
        const hasPhysical = Array.from(groups.values()).some((g) => !g.digitalOnly);
        if (hasPhysical && b.fulfillment === 'delivery' && !b.address) throw badRequest('ADDRESS_REQUIRED', 'Add a delivery address');
        const total = fromCents(Array.from(groups.values()).reduce((s, g) => s + g.now, 0n));
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
        // Pickup: a store with pickup points needs one chosen; it must be its own and open.
        const pickup = new Map<string, any>();
        if (hasPhysical && b.fulfillment === 'pickup') {
          for (const [merchantId, g] of groups) {
            if (g.digitalOnly) continue;
            const pts = await c.query(`SELECT id, name, description, city, address, hours, lat, lng FROM ${S}.pickup_points WHERE merchant_id = $1 AND active`, [merchantId]);
            if (!pts.rowCount) continue;
            const chosen = b.pickupPoints?.[merchantId];
            const pt = pts.rows.find((x) => String(x.id) === String(chosen));
            if (!pt) throw badRequest('PICKUP_POINT_REQUIRED', 'Choose where to pick up your order');
            pickup.set(merchantId, pt);
          }
        }
        const orders: any[] = [];
        for (const [merchantId, g] of groups) {
          const due = g.full - g.now;
          const order = await one<any>(
            `INSERT INTO ${S}.orders (user_id, merchant_id, total_amount, amount_paid, balance_due, deposit_refundable, status, payment_status, paid_at,
                                      escrow_status, checkout_ref, fulfillment, delivery_address, delivery_phone, delivery_lat, delivery_lng, buyer_note, handover_code)
             VALUES ($1, $2, $3, $4, $5, $6, 'processing', 'completed', now(), 'held', $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING id, total_amount, amount_paid, balance_due, status`,
            [
              userId,
              merchantId,
              fromCents(g.full),
              fromCents(g.now),
              fromCents(due),
              g.depositRefundable,
              checkoutRef,
              g.digitalOnly ? 'digital' : b.fulfillment,
              g.digitalOnly ? null : (b.address ?? null),
              g.digitalOnly ? null : (b.phone ?? null),
              g.digitalOnly ? null : (b.lat ?? null),
              g.digitalOnly ? null : (b.lng ?? null),
              b.note ?? null,
              g.digitalOnly ? null : handoverCode(),
            ],
            c,
          );
          const pt = pickup.get(merchantId);
          if (pt) await c.query(`UPDATE ${S}.orders SET pickup_point_id = $2, pickup_info = $3 WHERE id = $1`, [order.id, pt.id, JSON.stringify(pt)]);
          for (const l of g.lines) {
            await c.query(
              `INSERT INTO ${S}.order_items (order_id, product_id, quantity, price, is_digital, digital_file_url, product_name, licence_code)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [order.id, l.id, l.quantity, l.price, Boolean(l.is_digital), l.is_digital ? l.digital_file_url : null, l.name, l.is_digital ? licenceCode() : null],
            );
            if (!l.is_digital) {
              const s = await c.query(`UPDATE ${S}.products SET stock = stock - $2 WHERE id = $1 AND stock >= $2`, [l.id, l.quantity]);
              if (s.rowCount === 0) throw conflict('OUT_OF_STOCK', `${l.name} just sold out`);
            }
          }
          await addEvent(c, order.id, 'placed', 'buyer', { note: due > 0n ? `deposit ${fromCents(g.now)} / balance ${fromCents(due)}` : null });
          if (g.digitalOnly) await releaseEscrow(c, order.id, 'digital delivery');
          else
            await notifyBi(
              c,
              g.merchantUser,
              'new_order',
              ['New order', `Order #${short(order.id)} — ${money(fromCents(g.full))}${due > 0n ? ` (deposit ${money(fromCents(g.now))} paid)` : ''}`],
              ['طلب جديد', `الطلب #${short(order.id)} — ${money(fromCents(g.full))}${due > 0n ? ` (العربون ${money(fromCents(g.now))} مدفوع)` : ''}`],
              { orderId: order.id },
            );
          orders.push({ ...order, status: g.digitalOnly ? 'completed' : 'processing' });
        }
        await notifyBi(c, userId, 'order_placed', ['Order placed', `${money(total)} paid and held safely until you receive your order`], ['تم تأكيد طلبك', `${money(total)} مدفوعة ومحفوظة بأمان لحتى يوصلك طلبك`]);
        return { total, balance, orders, checkoutRef };
      });
      await audit({ userId, action: 'store.checkout', entityType: 'checkout', entityId: result.checkoutRef, details: { total: result.total } }, req);
      return { status: 201, body: { success: true, data: result } };
    });
    res.status(out.status).json(out.body);
  }),
);

// --------------------------------------------------------------- my orders
async function ordersWithItems(where: string, params: unknown[], opts: { buyer?: boolean } = {}) {
  const r = await pool.query(
    `SELECT o.id, o.user_id, o.merchant_id, o.total_amount, o.amount_paid, o.balance_due, o.balance_paid_via, o.deposit_refundable, o.status,
            o.payment_status, o.escrow_status, o.created_at, o.paid_at, o.accepted_at, o.shipped_at, o.delivered_at, o.completed_at,
            o.fulfillment, o.delivery_address, o.delivery_phone, o.delivery_lat, o.delivery_lng, o.buyer_note, o.dispute_status, o.dispute_reason,
            o.cancel_reason, o.pickup_info, ${opts.buyer ? 'o.handover_code,' : ''}
            m.store_name, m.branch_name, m.slug AS store_slug, m.logo_url AS store_logo, m.lat AS store_lat, m.lng AS store_lng, m.address AS store_address,
            m.user_id AS merchant_user_id, u.full_name AS buyer_name,
            COALESCE((SELECT json_agg(json_build_object('kind', e.kind, 'actor', e.actor, 'note', e.note, 'lat', e.lat, 'lng', e.lng, 'at', e.created_at) ORDER BY e.created_at)
                        FROM ${S}.order_events e WHERE e.order_id = o.id), '[]') AS events,
            COALESCE(json_agg(json_build_object('id', i.id, 'product_id', i.product_id, 'quantity', i.quantity, 'price', i.price,
                     'is_digital', i.is_digital, 'name', COALESCE(i.product_name, p.name), 'image_url', p.image_url,
                     'digital_mode', p.digital_mode, 'downloads', i.downloads, 'download_limit', p.download_limit, 'licence_code', i.licence_code))
                     FILTER (WHERE i.id IS NOT NULL), '[]') AS items
       FROM ${S}.orders o
       LEFT JOIN ${S}.merchants m ON m.id = o.merchant_id
       LEFT JOIN ${S}.users u ON u.id = o.user_id
       LEFT JOIN ${S}.order_items i ON i.order_id = o.id
       LEFT JOIN ${S}.products p ON p.id = i.product_id
      WHERE ${where} GROUP BY o.id, m.id, u.full_name ORDER BY o.created_at DESC LIMIT 100`,
    params,
  );
  return r.rows;
}

storeRouter.get(
  '/orders',
  requireAuth,
  ah(async (req, res) => {
    const orders = await ordersWithItems('o.user_id = $1', [req.auth!.userId], { buyer: true });
    res.json({ success: true, data: { orders: orders.map(({ merchant_user_id, ...o }) => o) } });
  }),
);

storeRouter.get(
  '/orders/:id',
  requireAuth,
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const [o] = await ordersWithItems('o.id = $1 AND o.user_id = $2', [req.params.id, req.auth!.userId], { buyer: true });
    if (!o) throw notFound('Order not found');
    const { merchant_user_id, ...rest } = o;
    res.json({ success: true, data: { order: rest } });
  }),
);

async function lockBuyerOrder(c: pg.PoolClient, id: string, userId: string) {
  const o = await one<any>(`SELECT * FROM ${S}.orders WHERE id = $1 AND user_id = $2 FOR UPDATE`, [id, userId], c);
  if (!o) throw notFound('Order not found');
  return o;
}
async function merchantUserOf(c: pg.PoolClient, merchantId: string) {
  return (await one<{ user_id: string }>(`SELECT user_id FROM ${S}.merchants WHERE id = $1`, [merchantId], c))!.user_id;
}

storeRouter.post(
  '/orders/:id/cancel',
  requireAuth,
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const done = await tx(async (c) => {
      const o = await lockBuyerOrder(c, String(req.params.id), req.auth!.userId);
      if (o.status !== 'processing' || o.dispute_status === 'open') throw conflict('CANNOT_CANCEL', 'Only orders that have not shipped can be cancelled');
      // A non-refundable deposit stays with the store once the store has accepted the order.
      const keepDeposit = Boolean(o.accepted_at) && !o.deposit_refundable && Number(o.balance_due) > 0;
      const r = await refundOrder(c, o.id, keepDeposit ? 'cancelled by buyer — deposit kept' : 'cancelled by buyer', { keepDeposit, actor: 'buyer' });
      if (r)
        await notifyBi(c, await merchantUserOf(c, o.merchant_id), 'order_cancelled', ['Order cancelled', `The buyer cancelled order #${short(o.id)}`], ['تم إلغاء طلب', `المشتري ألغى الطلب #${short(o.id)}`], {
          orderId: o.id,
        });
      return r;
    });
    if (!done) throw conflict('CANNOT_CANCEL', 'This order cannot be cancelled');
    res.json({ success: true });
  }),
);

/** Buyer pays the remaining balance (after a deposit) from the wallet. Held in escrow like the deposit. */
storeRouter.post(
  '/orders/:id/pay-balance',
  requireAuth,
  moneyLimiter,
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ totp: totpCode.optional() }).strict() }),
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    await requireSecondFactor(userId, req.body.totp);
    const out = await tx(async (c) => {
      const o = await lockBuyerOrder(c, String(req.params.id), userId);
      if (o.escrow_status !== 'held' || toCents(String(o.balance_due)) <= 0n) throw conflict('NOTHING_DUE', 'Nothing left to pay on this order');
      const due = String(o.balance_due);
      const w = await walletOfUser(userId, c, true);
      await assertDailyLimit(c, w.wallet_id, due);
      const balance = await debit(c, w.id, due);
      await writeLine(c, { userId, walletId: w.wallet_id, type: 'purchase', amount: `-${due}`, description: `Balance for order #${short(o.id)}`, metadata: { orderId: o.id }, balanceAfter: balance });
      await c.query(
        `UPDATE ${S}.orders SET amount_paid = amount_paid + balance_due, balance_due = 0, balance_paid_at = now(), balance_paid_via = 'wallet', updated_at = now() WHERE id = $1`,
        [o.id],
      );
      await addEvent(c, o.id, 'balance_paid', 'buyer', { note: due });
      await notifyBi(c, await merchantUserOf(c, o.merchant_id), 'balance_paid', ['Balance paid', `${money(due)} paid for order #${short(o.id)} — held until delivery`], ['تم دفع باقي المبلغ', `${money(due)} للطلب #${short(o.id)} — محفوظة لحد التسليم`], {
        orderId: o.id,
      });
      return { balance };
    });
    res.json({ success: true, data: out });
  }),
);

storeRouter.post(
  '/orders/:id/confirm',
  requireAuth,
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const done = await tx(async (c) => {
      const o = await lockBuyerOrder(c, String(req.params.id), req.auth!.userId);
      if (!['processing', 'shipped', 'delivered'].includes(o.status)) throw conflict('CANNOT_CONFIRM', 'This order is already closed');
      if (toCents(String(o.balance_due)) > 0n) throw conflict('BALANCE_DUE', 'Pay the remaining balance first (or pay the store in cash on delivery)');
      await addEvent(c, o.id, 'confirmed', 'buyer');
      return releaseEscrow(c, o.id, 'received by buyer', 'buyer');
    });
    if (!done) throw conflict('CANNOT_CONFIRM', 'This order is already closed');
    res.json({ success: true });
  }),
);

/** Something went wrong: freezes the money (no auto-release) until an admin decides. */
storeRouter.post(
  '/orders/:id/dispute',
  requireAuth,
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ reason: z.string().trim().min(5).max(500) }).strict() }),
  ah(async (req, res) => {
    await tx(async (c) => {
      const o = await lockBuyerOrder(c, String(req.params.id), req.auth!.userId);
      if (o.escrow_status !== 'held') throw conflict('CANNOT_DISPUTE', 'This order is already settled');
      if (o.dispute_status === 'open') throw conflict('ALREADY_DISPUTED', 'A dispute is already open');
      await c.query(`UPDATE ${S}.orders SET dispute_status = 'open', dispute_reason = $2, updated_at = now() WHERE id = $1`, [o.id, req.body.reason]);
      await addEvent(c, o.id, 'disputed', 'buyer', { note: req.body.reason });
      await notifyBi(c, await merchantUserOf(c, o.merchant_id), 'order_disputed', ['Problem reported', `The buyer reported a problem with order #${short(o.id)}. Payment is on hold.`], [
        'تم الإبلاغ عن مشكلة',
        `المشتري بلّغ عن مشكلة بالطلب #${short(o.id)}. الدفعة موقوفة لحد ما تنحل.`,
      ], { orderId: o.id });
      const admins = await c.query(`SELECT id FROM ${S}.users WHERE role = 'admin' AND status = 'active'`);
      for (const a of admins.rows)
        await notifyBi(c, a.id, 'dispute_opened', ['New dispute', `Order #${short(o.id)}: ${req.body.reason.slice(0, 120)}`], ['نزاع جديد', `الطلب #${short(o.id)}: ${req.body.reason.slice(0, 120)}`], { orderId: o.id });
    });
    res.json({ success: true });
  }),
);

// -------------------------------------------------- protected digital files
/**
 * Paid files are never handed out as links. The buyer asks for a ticket (valid
 * 60 s, single use, bound to their account); the file is then streamed through
 * the server and every PDF is stamped with the buyer's e-mail and a licence code
 * on each page, so a leaked copy always points back to who shared it.
 */
storeRouter.post(
  '/orders/:orderId/items/:itemId/ticket',
  requireAuth,
  validate({ params: z.object({ orderId: idParam, itemId: idParam }).strict(), body: z.object({ purpose: z.enum(['download', 'view']).default('download') }).strict() }),
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    const item = await one<any>(
      `SELECT i.id, i.downloads, i.digital_file_url, o.payment_status, o.status, COALESCE(p.digital_mode, 'download') AS mode, COALESCE(p.download_limit, 3) AS lim
         FROM ${S}.order_items i JOIN ${S}.orders o ON o.id = i.order_id LEFT JOIN ${S}.products p ON p.id = i.product_id
        WHERE i.id = $1 AND o.id = $2 AND o.user_id = $3 AND i.is_digital`,
      [req.params.itemId, req.params.orderId, userId],
    );
    if (!item || item.payment_status !== 'completed' || item.status === 'cancelled' || !item.digital_file_url) throw notFound('Download not available');
    const purpose = item.mode === 'view' ? 'view' : req.body.purpose;
    if (purpose === 'download' && Number(item.downloads) >= Number(item.lim)) throw tooMany('Download limit reached for this purchase', 'DOWNLOAD_LIMIT');
    const recent = await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.download_tickets WHERE order_item_id = $1 AND created_at > now() - interval '1 hour'`, [item.id]);
    if ((recent?.n ?? 0) >= 20) throw tooMany('Too many requests for this file, try later', 'TICKET_LIMIT');
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.query(
      `INSERT INTO ${S}.download_tickets (order_item_id, user_id, token_hash, purpose, expires_at, ip_address) VALUES ($1, $2, $3, $4, now() + interval '60 seconds', $5)`,
      [item.id, userId, sha256(token), purpose, clientIp(req)],
    );
    res.json({ success: true, data: { url: `/api/store/file/${token}`, purpose, expiresIn: 60 } });
  }),
);

storeRouter.get(
  '/file/:token',
  validate({ params: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{40,60}$/) }).strict() }),
  ah(async (req: Request, res) => {
    // Single use: the UPDATE … RETURNING claims the ticket atomically.
    const t = await one<any>(
      `UPDATE ${S}.download_tickets SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING *`,
      [sha256(String(req.params.token))],
    );
    if (!t) throw notFound('This link has expired. Open the file again from your orders.', 'TICKET_EXPIRED');
    const item = await one<any>(
      `SELECT i.id, i.digital_file_url, i.licence_code, COALESCE(i.product_name, p.name) AS name, o.id AS order_id, u.email
         FROM ${S}.order_items i JOIN ${S}.orders o ON o.id = i.order_id JOIN ${S}.users u ON u.id = o.user_id
         LEFT JOIN ${S}.products p ON p.id = i.product_id WHERE i.id = $1 AND o.user_id = $2`,
      [t.order_item_id, t.user_id],
    );
    if (!item) throw notFound('File not found');
    const d = await privateDownload(item.digital_file_url);
    if (!d) throw notFound('File not found');
    const stamped = await personalise(d.file.data, d.file.mime, {
      email: item.email,
      licence: item.licence_code ?? `ORDER-${short(item.order_id)}`,
      order: short(item.order_id),
      viewOnly: t.purpose === 'view',
    });
    if (t.purpose === 'download') await pool.query(`UPDATE ${S}.order_items SET downloads = downloads + 1 WHERE id = $1`, [item.id]);
    await audit({ userId: t.user_id, action: `store.file_${t.purpose}`, entityType: 'order_item', entityId: item.id, details: { licence: item.licence_code } }, req);
    const ext = d.file.filename.includes('.') ? d.file.filename.split('.').pop()!.slice(0, 8) : 'bin';
    const safe = (String(item.name).replace(/[^\p{L}\p{N} ._-]/gu, '_').slice(0, 70) || 'download') + `-${item.licence_code ?? ''}.${ext}`;
    res.setHeader('Content-Type', t.purpose === 'view' ? stamped.mime : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${t.purpose === 'view' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(safe)}`);
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(stamped.data);
  }),
);

// ================================================================= merchant
export const merchantRouter = Router();
merchantRouter.use(requireAuth, requireRole('merchant'));

/** The store this request acts on: the x-store-id header (must be owned), else the first store. */
async function myMerchant(req: Request | string, c?: pg.PoolClient) {
  const userId = typeof req === 'string' ? req : req.auth!.userId;
  const wanted = typeof req === 'string' ? undefined : String(req.headers['x-store-id'] ?? '').trim();
  const m = wanted && idParam.safeParse(wanted).success
    ? await one<any>(`SELECT * FROM ${S}.merchants WHERE user_id = $1 AND id = $2 AND COALESCE(status,'active') <> 'closed'`, [userId, wanted], c)
    : await one<any>(`SELECT * FROM ${S}.merchants WHERE user_id = $1 AND COALESCE(status,'active') <> 'closed' ORDER BY parent_id NULLS FIRST, created_at ASC NULLS LAST LIMIT 1`, [userId], c);
  if (!m) throw notFound('Create your store profile first', 'NO_STORE');
  return m;
}

const optUrl = z
  .string()
  .max(500)
  .refine((u) => u.startsWith('/files/') || /^https:\/\/[a-z0-9.-]+\.supabase\.co\/storage\//i.test(u), 'Upload the image first');
/** A social handle ("@name") — stored without the @. */
const social = z
  .string()
  .trim()
  .transform((v) => v.replace(/^@/, '').replace(/^https?:\/\/(www\.)?(instagram|tiktok|facebook)\.com\/@?/i, '').replace(/\/+$/, ''))
  .pipe(z.string().regex(/^[A-Za-z0-9_.]{0,60}$/, 'Use the account name only, e.g. @mystore'))
  .transform((v) => v || null)
  .optional()
  .nullable();

const storeBody = z
  .object({
    storeName: z.string().trim().min(2).max(60),
    description: z.string().trim().max(500).optional().default(''),
    logoUrl: optUrl.optional().nullable(),
    coverUrl: optUrl.optional().nullable(),
    category: z.enum(STORE_CATEGORIES).optional(),
    city: z.string().trim().max(60).optional().nullable(),
    address: z.string().trim().max(200).optional().nullable(),
    lat: z.number().min(-90).max(90).optional().nullable(),
    lng: z.number().min(-180).max(180).optional().nullable(),
    phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/).optional().nullable(),
    showPhone: z.boolean().optional(),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
    deliveryNote: z.string().trim().max(200).optional().nullable(),
    offersPickup: z.boolean().optional(),
    offersDelivery: z.boolean().optional(),
    parentId: idParam.optional(),
    branchName: z.string().trim().min(2).max(60).optional(),
    instagram: social,
    tiktok: social,
    facebook: social,
  })
  .strict();

const slugify = (name: string) =>
  `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || 'store'
  }-${crypto.randomBytes(3).toString('hex')}`;

const STORE_COLS = `id, slug, store_name, branch_name, parent_id, description, logo_url, cover_url, category, city, address, lat, lng, phone, show_phone,
  accent, delivery_note, offers_pickup, offers_delivery, status, created_at, instagram, tiktok, facebook`;

merchantRouter.get(
  '/stores',
  ah(async (req, res) => {
    const r = await pool.query(
      `SELECT ${STORE_COLS} FROM ${S}.merchants WHERE user_id = $1 AND COALESCE(status,'active') <> 'closed' ORDER BY COALESCE(parent_id, id), parent_id NULLS FIRST, created_at`,
      [req.auth!.userId],
    );
    res.json({ success: true, data: { stores: r.rows } });
  }),
);

async function createStore(userId: string, b: z.infer<typeof storeBody>) {
  if (b.parentId) {
    const parent = await one(`SELECT id FROM ${S}.merchants WHERE id = $1 AND user_id = $2 AND parent_id IS NULL`, [b.parentId, userId]);
    if (!parent) throw notFound('Main store not found');
  }
  const count = await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.merchants WHERE user_id = $1 AND COALESCE(status,'active') <> 'closed'`, [userId]);
  if ((count?.n ?? 0) >= 20) throw conflict('STORE_LIMIT', 'You can have up to 20 stores and branches');
  const w = await walletOfUser(userId);
  return one(
    `INSERT INTO ${S}.merchants (user_id, store_name, description, wallet_id, status, logo_url, cover_url, category, city, address, lat, lng, phone, show_phone,
                                 accent, delivery_note, offers_pickup, offers_delivery, parent_id, branch_name, slug)
     VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) RETURNING ${STORE_COLS}`,
    [
      userId,
      b.storeName,
      b.description ?? '',
      w.id,
      b.logoUrl ?? null,
      b.coverUrl ?? null,
      b.category ?? 'other',
      b.city ?? null,
      b.address ?? null,
      b.lat ?? null,
      b.lng ?? null,
      b.phone ?? null,
      b.showPhone ?? false,
      b.accent ?? null,
      b.deliveryNote ?? null,
      b.offersPickup ?? true,
      b.offersDelivery ?? true,
      b.parentId ?? null,
      b.parentId ? (b.branchName ?? b.city ?? null) : null,
      slugify(`${b.storeName}${b.branchName ? `-${b.branchName}` : ''}`),
    ],
  );
}

merchantRouter.post(
  '/stores',
  validate({ body: storeBody }),
  ah(async (req, res) => {
    const m: any = await createStore(req.auth!.userId, req.body);
    const { instagram, tiktok, facebook } = req.body;
    if (instagram || tiktok || facebook) {
      await pool.query(`UPDATE ${S}.merchants SET instagram = $2, tiktok = $3, facebook = $4 WHERE id = $1`, [m.id, instagram ?? null, tiktok ?? null, facebook ?? null]);
      Object.assign(m, { instagram: instagram ?? null, tiktok: tiktok ?? null, facebook: facebook ?? null });
    }
    await audit({ userId: req.auth!.userId, action: 'merchant.store_created', entityType: 'merchant', entityId: (m as any).id }, req);
    res.status(201).json({ success: true, data: { store: m } });
  }),
);

const COLMAP: Record<string, string> = {
  storeName: 'store_name',
  description: 'description',
  logoUrl: 'logo_url',
  coverUrl: 'cover_url',
  category: 'category',
  city: 'city',
  address: 'address',
  lat: 'lat',
  lng: 'lng',
  phone: 'phone',
  showPhone: 'show_phone',
  accent: 'accent',
  deliveryNote: 'delivery_note',
  offersPickup: 'offers_pickup',
  offersDelivery: 'offers_delivery',
  branchName: 'branch_name',
  instagram: 'instagram',
  tiktok: 'tiktok',
  facebook: 'facebook',
};

merchantRouter.patch(
  '/stores/:id',
  validate({ params: z.object({ id: idParam }).strict(), body: storeBody.omit({ parentId: true }).partial().strict() }),
  ah(async (req, res) => {
    const sets: string[] = [];
    const vals: unknown[] = [req.params.id, req.auth!.userId];
    for (const [k, v] of Object.entries(req.body)) {
      if (!COLMAP[k] || v === undefined) continue;
      vals.push(v);
      sets.push(`${COLMAP[k]} = $${vals.length}`);
    }
    if (!sets.length) return res.json({ success: true });
    const r = await pool.query(`UPDATE ${S}.merchants SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND user_id = $2`, vals);
    if (r.rowCount === 0) throw notFound('Store not found');
    res.json({ success: true });
  }),
);

merchantRouter.delete(
  '/stores/:id',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const m = await one<any>(`SELECT id FROM ${S}.merchants WHERE id = $1 AND user_id = $2`, [req.params.id, req.auth!.userId]);
    if (!m) throw notFound('Store not found');
    const open = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${S}.orders o JOIN ${S}.merchants b ON b.id = o.merchant_id WHERE (b.id = $1 OR b.parent_id = $1) AND o.escrow_status = 'held'`,
      [m.id],
    );
    if ((open?.n ?? 0) > 0) throw conflict('OPEN_ORDERS', 'Finish or cancel the open orders of this store first');
    await pool.query(`UPDATE ${S}.merchants SET status = 'closed', updated_at = now() WHERE id = $1 OR parent_id = $1`, [m.id]);
    await audit({ userId: req.auth!.userId, action: 'merchant.store_closed', entityType: 'merchant', entityId: m.id }, req);
    res.json({ success: true });
  }),
);

// Backwards-compatible single-store profile (the current store).
merchantRouter.get(
  '/profile',
  ah(async (req, res) => {
    const m = await one(
      `SELECT ${STORE_COLS} FROM ${S}.merchants WHERE user_id = $1 AND COALESCE(status,'active') <> 'closed'
        AND ($2::text = '' OR id::text = $2) ORDER BY parent_id NULLS FIRST, created_at LIMIT 1`,
      [req.auth!.userId, String(req.headers['x-store-id'] ?? '')],
    );
    res.json({ success: true, data: { merchant: m } });
  }),
);

merchantRouter.post(
  '/profile',
  validate({ body: storeBody }),
  ah(async (req, res) => {
    const m: any = await createStore(req.auth!.userId, req.body);
    const { instagram, tiktok, facebook } = req.body;
    if (instagram || tiktok || facebook) {
      await pool.query(`UPDATE ${S}.merchants SET instagram = $2, tiktok = $3, facebook = $4 WHERE id = $1`, [m.id, instagram ?? null, tiktok ?? null, facebook ?? null]);
      Object.assign(m, { instagram: instagram ?? null, tiktok: tiktok ?? null, facebook: facebook ?? null });
    }
    res.status(201).json({ success: true, data: { merchant: m } });
  }),
);

merchantRouter.patch(
  '/profile',
  validate({ body: storeBody.omit({ parentId: true }).partial().strict() }),
  ah(async (req, res) => {
    const m = await myMerchant(req);
    const sets: string[] = [];
    const vals: unknown[] = [m.id];
    for (const [k, v] of Object.entries(req.body)) {
      if (!COLMAP[k] || v === undefined) continue;
      vals.push(v);
      sets.push(`${COLMAP[k]} = $${vals.length}`);
    }
    if (sets.length) await pool.query(`UPDATE ${S}.merchants SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
    res.json({ success: true });
  }),
);

merchantRouter.get(
  '/stats',
  ah(async (req, res) => {
    const m = await myMerchant(req);
    const s = await one(
      `SELECT COALESCE(SUM(COALESCE(amount_paid, total_amount)) FILTER (WHERE escrow_status = 'released'), 0)::text AS revenue,
              COALESCE(SUM(COALESCE(amount_paid, total_amount)) FILTER (WHERE escrow_status = 'held'), 0)::text AS in_escrow,
              COALESCE(SUM(balance_due) FILTER (WHERE escrow_status = 'held'), 0)::text AS balance_due,
              count(*) FILTER (WHERE status = 'processing')::int AS to_ship,
              count(*) FILTER (WHERE status = 'shipped')::int AS shipped,
              count(*) FILTER (WHERE status = 'completed')::int AS completed,
              count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
              count(*) FILTER (WHERE dispute_status = 'open')::int AS disputes
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
    res.json({ success: true, data: { stats: s, series: series.rows, topProducts: top.rows, store: { id: m.id, slug: m.slug, store_name: m.store_name, branch_name: m.branch_name } } });
  }),
);

const productBody = z
  .object({
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(2000).optional().default(''),
    price: amountSchema,
    compareAtPrice: amountSchema.optional().nullable(),
    stock: z.number().int().min(0).max(1_000_000).default(0),
    category: z.string().trim().max(40).optional(),
    imageUrl: optUrl.optional().nullable(),
    isDigital: z.boolean().default(false),
    digitalFileRef: z.string().max(500).optional().nullable(),
    digitalMode: z.enum(['download', 'view']).default('download'),
    downloadLimit: z.number().int().min(1).max(20).default(3),
    depositPercent: z.number().int().min(0).max(90).default(0),
    depositRefundable: z.boolean().default(true),
  })
  .strict();

const PRODUCT_COLS = `id, name, description, price, compare_at_price, image_url, stock, is_digital, category, COALESCE(status,'active') AS status, created_at,
  (digital_file_url IS NOT NULL) AS has_file, digital_mode, download_limit, deposit_percent, deposit_refundable`;

merchantRouter.get(
  '/products',
  ah(async (req, res) => {
    const m = await myMerchant(req);
    const r = await pool.query(`SELECT ${PRODUCT_COLS} FROM ${S}.products WHERE merchant_id = $1 AND COALESCE(status,'active') <> 'deleted' ORDER BY created_at DESC`, [m.id]);
    res.json({ success: true, data: { products: r.rows } });
  }),
);

merchantRouter.post(
  '/products',
  validate({ body: productBody }),
  ah(async (req, res) => {
    const m = await myMerchant(req);
    const b = req.body;
    if (b.isDigital && !b.digitalFileRef) throw badRequest('FILE_REQUIRED', 'Upload the digital file first');
    if (b.digitalFileRef) await assertOwnFileRef(req.auth!.userId, b.digitalFileRef);
    const p = await one(
      `INSERT INTO ${S}.products (merchant_id, name, description, price, compare_at_price, image_url, stock, is_digital, digital_file_url, category, status,
                                  digital_mode, download_limit, deposit_percent, deposit_refundable)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11, $12, $13, $14) RETURNING ${PRODUCT_COLS}`,
      [
        m.id,
        b.name,
        b.description,
        b.price,
        b.compareAtPrice ?? null,
        b.imageUrl ?? null,
        b.isDigital ? 0 : b.stock,
        b.isDigital,
        b.isDigital ? b.digitalFileRef : null,
        b.category ?? null,
        b.digitalMode,
        b.downloadLimit,
        b.isDigital ? 0 : b.depositPercent,
        b.depositRefundable,
      ],
    );
    res.status(201).json({ success: true, data: { product: p } });
  }),
);

merchantRouter.put(
  '/products/:id',
  validate({ params: z.object({ id: idParam }).strict(), body: productBody.extend({ status: z.enum(['active', 'hidden']).optional() }).strict() }),
  ah(async (req, res) => {
    const m = await myMerchant(req);
    const b = req.body;
    if (b.digitalFileRef) await assertOwnFileRef(req.auth!.userId, b.digitalFileRef);
    const r = await pool.query(
      `UPDATE ${S}.products SET name = $3, description = $4, price = $5, image_url = $6, stock = $7, is_digital = $8,
              digital_file_url = COALESCE($9, digital_file_url), category = $10, status = COALESCE($11, status), compare_at_price = $12,
              digital_mode = $13, download_limit = $14, deposit_percent = $15, deposit_refundable = $16, updated_at = now()
        WHERE id = $1 AND merchant_id = $2 AND COALESCE(status,'active') <> 'deleted'`,
      [
        req.params.id,
        m.id,
        b.name,
        b.description,
        b.price,
        b.imageUrl ?? null,
        b.isDigital ? 0 : b.stock,
        b.isDigital,
        b.digitalFileRef ?? null,
        b.category ?? null,
        b.status ?? null,
        b.compareAtPrice ?? null,
        b.digitalMode,
        b.downloadLimit,
        b.isDigital ? 0 : b.depositPercent,
        b.depositRefundable,
      ],
    );
    if (r.rowCount === 0) throw notFound('Product not found');
    res.json({ success: true });
  }),
);

merchantRouter.delete(
  '/products/:id',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const m = await myMerchant(req);
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

// --------------------------------------------------------------------- ads
const adBody = z
  .object({
    kind: z.enum(['image', 'video']),
    mediaUrl: optUrl,
    title: z.string().trim().max(80).optional().nullable(),
    body: z.string().trim().max(240).optional().nullable(),
    productId: idParam.optional().nullable(),
    active: z.boolean().default(true),
    sort: z.number().int().min(0).max(100).default(0),
    endsAt: z.string().datetime().optional().nullable(),
  })
  .strict();

merchantRouter.get(
  '/ads',
  ah(async (req, res) => {
    const m = await myMerchant(req);
    const r = await pool.query(`SELECT id, kind, media_url, title, body, product_id, active, sort, ends_at, created_at FROM ${S}.store_ads WHERE merchant_id = $1 ORDER BY sort, created_at DESC`, [m.id]);
    res.json({ success: true, data: { ads: r.rows } });
  }),
);

merchantRouter.post(
  '/ads',
  validate({ body: adBody }),
  ah(async (req, res) => {
    const m = await myMerchant(req);
    const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.store_ads WHERE merchant_id = $1`, [m.id]);
    if ((n?.n ?? 0) >= 12) throw conflict('AD_LIMIT', 'Up to 12 ads per store');
    const b = req.body;
    const ad = await one(
      `INSERT INTO ${S}.store_ads (merchant_id, kind, media_url, title, body, product_id, active, sort, ends_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [m.id, b.kind, b.mediaUrl, b.title ?? null, b.body ?? null, b.productId ?? null, b.active, b.sort, b.endsAt ?? null],
    );
    res.status(201).json({ success: true, data: { ad } });
  }),
);

merchantRouter.put(
  '/ads/:id',
  validate({ params: z.object({ id: idParam }).strict(), body: adBody }),
  ah(async (req, res) => {
    const m = await myMerchant(req);
    const b = req.body;
    const r = await pool.query(
      `UPDATE ${S}.store_ads SET kind = $3, media_url = $4, title = $5, body = $6, product_id = $7, active = $8, sort = $9, ends_at = $10 WHERE id = $1 AND merchant_id = $2`,
      [req.params.id, m.id, b.kind, b.mediaUrl, b.title ?? null, b.body ?? null, b.productId ?? null, b.active, b.sort, b.endsAt ?? null],
    );
    if (r.rowCount === 0) throw notFound('Ad not found');
    res.json({ success: true });
  }),
);

merchantRouter.delete(
  '/ads/:id',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const m = await myMerchant(req);
    const r = await pool.query(`DELETE FROM ${S}.store_ads WHERE id = $1 AND merchant_id = $2`, [req.params.id, m.id]);
    if (r.rowCount === 0) throw notFound('Ad not found');
    res.json({ success: true });
  }),
);

// ----------------------------------------------------------------- uploads
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const mediaUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
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

/** Ad media: an image or a short MP4/WebM video. */
merchantRouter.post(
  '/uploads/media',
  mediaUpload.single('file'),
  ah(async (req, res) => {
    if (!req.file) throw badRequest('NO_FILE', 'Choose an image or a video');
    const t = await fileTypeFromBuffer(req.file.buffer);
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'];
    if (!t || !ok.includes(t.mime)) throw badRequest('INVALID_MEDIA', 'Use JPEG, PNG, WebP, GIF, MP4 or WebM');
    if (t.mime.startsWith('image/') && req.file.size > 5 * 1024 * 1024) throw badRequest('TOO_LARGE', 'Images up to 5 MB');
    const stored = await putFile('product-images', req.auth!.userId, t.ext, t.mime, req.file.buffer, req.file.originalname);
    res.status(201).json({ success: true, data: { url: stored.url, kind: t.mime.startsWith('video/') ? 'video' : 'image' } });
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
    res.status(201).json({ success: true, data: { ref: stored.ref, name: req.file.originalname, size: req.file.size, stampable: t?.mime === 'application/pdf' } });
  }),
);

// ------------------------------------------------------------------ orders
merchantRouter.get(
  '/orders',
  validate({ query: z.object({ all: z.enum(['1']).optional() }).strict() }),
  ah(async (req, res) => {
    // ?all=1 → every store and branch of this merchant; otherwise the current store.
    const orders =
      req.query.all === '1'
        ? await ordersWithItems(`o.merchant_id IN (SELECT id FROM ${S}.merchants WHERE user_id = $1)`, [req.auth!.userId])
        : await ordersWithItems('o.merchant_id = $1', [(await myMerchant(req)).id]);
    res.json({ success: true, data: { orders: orders.map(({ user_id, merchant_user_id, ...o }) => o) } });
  }),
);

async function lockMerchantOrder(c: pg.PoolClient, req: Request) {
  const o = await one<any>(
    `SELECT o.* FROM ${S}.orders o JOIN ${S}.merchants m ON m.id = o.merchant_id WHERE o.id = $1 AND m.user_id = $2 FOR UPDATE OF o`,
    [req.params.id, req.auth!.userId],
    c,
  );
  if (!o) throw notFound('Order not found');
  return o;
}

merchantRouter.post(
  '/orders/:id/accept',
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ note: z.string().trim().max(200).optional() }).strict() }),
  ah(async (req, res) => {
    await tx(async (c) => {
      const o = await lockMerchantOrder(c, req);
      if (o.status !== 'processing' || o.accepted_at) throw conflict('CANNOT_ACCEPT', 'This order was already accepted or closed');
      await c.query(`UPDATE ${S}.orders SET accepted_at = now(), updated_at = now() WHERE id = $1`, [o.id]);
      await addEvent(c, o.id, 'accepted', 'merchant', { note: req.body.note });
      await notifyBi(c, o.user_id, 'order_accepted', ['Order accepted', `The store is preparing order #${short(o.id)}`], ['المتجر قبل طلبك', `المتجر بجهّز الطلب #${short(o.id)}`], { orderId: o.id });
    });
    res.json({ success: true });
  }),
);

const geo = { lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() };

merchantRouter.post(
  '/orders/:id/ship',
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ note: z.string().trim().max(200).optional(), ...geo }).strict() }),
  ah(async (req, res) => {
    await tx(async (c) => {
      const o = await lockMerchantOrder(c, req);
      if (o.status !== 'processing') throw conflict('CANNOT_SHIP', 'Only paid, unshipped orders can be marked as shipped');
      await c.query(`UPDATE ${S}.orders SET status = 'shipped', shipped_at = now(), accepted_at = COALESCE(accepted_at, now()), updated_at = now() WHERE id = $1`, [o.id]);
      const kind = o.fulfillment === 'pickup' ? 'ready_for_pickup' : 'shipped';
      await addEvent(c, o.id, kind, 'merchant', { note: req.body.note, lat: req.body.lat, lng: req.body.lng });
      await notifyBi(
        c,
        o.user_id,
        'order_shipped',
        o.fulfillment === 'pickup'
          ? ['Ready for pickup', `Order #${short(o.id)} is ready. Show your handover code at the store.`]
          : ['Order shipped', `Order #${short(o.id)} is on its way. Give the courier your handover code when it arrives.`],
        o.fulfillment === 'pickup'
          ? ['طلبك جاهز للاستلام', `الطلب #${short(o.id)} جاهز. اعرض رمز الاستلام بالمتجر.`]
          : ['طلبك بالطريق', `الطلب #${short(o.id)} انشحن. أعطِ المندوب رمز الاستلام لما يوصل.`],
        { orderId: o.id },
      );
    });
    res.json({ success: true });
  }),
);

/** Tracking update: where the order is now (location and/or a note). */
merchantRouter.post(
  '/orders/:id/track',
  validate({
    params: z.object({ id: idParam }).strict(),
    body: z.object({ kind: z.enum(['location', 'note', 'out_for_delivery']).default('location'), note: z.string().trim().max(200).optional(), ...geo }).strict(),
  }),
  ah(async (req, res) => {
    await tx(async (c) => {
      const o = await lockMerchantOrder(c, req);
      if (!['processing', 'shipped'].includes(o.status)) throw conflict('ORDER_CLOSED', 'This order is closed');
      if (req.body.kind === 'location' && (req.body.lat == null || req.body.lng == null)) throw badRequest('LOCATION_REQUIRED', 'Share a location');
      await addEvent(c, o.id, req.body.kind, 'merchant', { note: req.body.note, lat: req.body.lat, lng: req.body.lng });
      const ar = req.body.kind === 'out_for_delivery' ? 'المندوب طالع لعندك هلّأ' : req.body.note ? req.body.note : 'تحدّث موقع طلبك';
      const en = req.body.kind === 'out_for_delivery' ? 'Out for delivery now' : req.body.note ? req.body.note : 'Your order location was updated';
      await notifyBi(c, o.user_id, 'order_update', [`Order #${short(o.id)}`, en], [`الطلب #${short(o.id)}`, ar], { orderId: o.id });
    });
    res.json({ success: true });
  }),
);

/**
 * Proof of delivery: the buyer's 6-digit handover code. Only the buyer has it, so
 * the store can't claim a delivery that didn't happen, and once the buyer hands it
 * over they can't deny receiving the order. Settles the money immediately.
 */
merchantRouter.post(
  '/orders/:id/deliver',
  validate({
    params: z.object({ id: idParam }).strict(),
    body: z.object({ code: z.string().regex(/^\d{6}$/), cashBalance: z.boolean().default(false), ...geo }).strict(),
  }),
  ah(async (req, res) => {
    const result = await tx(async (c) => {
      const o = await lockMerchantOrder(c, req);
      if (!['processing', 'shipped'].includes(o.status) || o.escrow_status !== 'held') throw conflict('ORDER_CLOSED', 'This order is closed');
      if (o.dispute_status === 'open') throw conflict('DISPUTE_OPEN', 'This order has an open dispute — support will contact you');
      if (o.handover_attempts >= 5) throw tooMany('Too many wrong codes. Ask the buyer to confirm receipt in the app.', 'HANDOVER_LOCKED');
      const ok = o.handover_code && crypto.timingSafeEqual(Buffer.from(String(o.handover_code)), Buffer.from(req.body.code));
      if (!ok) {
        await c.query(`UPDATE ${S}.orders SET handover_attempts = handover_attempts + 1 WHERE id = $1`, [o.id]);
        return { wrong: true as const };
      }
      if (toCents(String(o.balance_due)) > 0n) {
        if (!req.body.cashBalance) throw conflict('BALANCE_DUE', 'The buyer still owes the balance — collect it in cash or ask them to pay in the app');
        await c.query(`UPDATE ${S}.orders SET balance_paid_at = now(), balance_paid_via = 'cash', balance_due = 0 WHERE id = $1`, [o.id]);
        await addEvent(c, o.id, 'balance_paid', 'merchant', { note: `cash ${o.balance_due}` });
      }
      await c.query(`UPDATE ${S}.orders SET status = 'delivered', delivered_at = now() WHERE id = $1`, [o.id]);
      await addEvent(c, o.id, 'delivered', 'merchant', { lat: req.body.lat, lng: req.body.lng });
      await releaseEscrow(c, o.id, 'delivered with handover code', 'merchant');
      await notifyBi(c, o.user_id, 'order_delivered', ['Order delivered', `Order #${short(o.id)} was handed over. Enjoy!`], ['تم تسليم طلبك', `الطلب #${short(o.id)} انسلّم. بالهنا!`], { orderId: o.id });
      return { wrong: false as const };
    });
    if (result.wrong) throw badRequest('WRONG_HANDOVER_CODE', 'That code is not right');
    res.json({ success: true });
  }),
);

merchantRouter.post(
  '/orders/:id/cancel',
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ reason: z.string().trim().max(200).optional() }).strict() }),
  ah(async (req, res) => {
    const done = await tx(async (c) => {
      const o = await lockMerchantOrder(c, req);
      if (o.dispute_status === 'open') throw conflict('DISPUTE_OPEN', 'Support is handling this order');
      const r = await refundOrder(c, o.id, req.body.reason ? `cancelled by store: ${req.body.reason}` : 'cancelled by store', { actor: 'merchant' });
      if (r)
        await notifyBi(c, o.user_id, 'order_cancelled', ['Order cancelled by the store', `Order #${short(o.id)} — your money is back in your wallet`], [
          'المتجر ألغى طلبك',
          `الطلب #${short(o.id)} — رجعت مصاريك لمحفظتك`,
        ], { orderId: o.id });
      return r;
    });
    if (!done) throw conflict('CANNOT_CANCEL', 'This order can no longer be cancelled');
    await audit({ userId: req.auth!.userId, action: 'merchant.order_cancelled', entityType: 'order', entityId: req.params.id }, req);
    res.json({ success: true });
  }),
);

/** Licence lookup: who bought the copy carrying this code (for leaked files). */
merchantRouter.get(
  '/licences/:code',
  validate({ params: z.object({ code: z.string().regex(/^ST-[0-9A-F]{4}-[0-9A-F]{4}$/) }).strict() }),
  ah(async (req, res) => {
    const r = await one(
      `SELECT i.licence_code, COALESCE(i.product_name, p.name) AS product, i.downloads, o.id AS order_id, o.created_at, u.full_name AS buyer_name, u.email AS buyer_email
         FROM ${S}.order_items i JOIN ${S}.orders o ON o.id = i.order_id JOIN ${S}.merchants m ON m.id = o.merchant_id
         JOIN ${S}.users u ON u.id = o.user_id LEFT JOIN ${S}.products p ON p.id = i.product_id
        WHERE i.licence_code = $1 AND m.user_id = $2`,
      [req.params.code, req.auth!.userId],
    );
    if (!r) throw notFound('No sale with this licence code');
    res.json({ success: true, data: { licence: r } });
  }),
);

// ------------------------------------------------------------ pickup points
/** Public: open pickup points of the given stores (checkout shows them only when there are some). */
storeRouter.get(
  '/pickup-points',
  validate({ query: z.object({ stores: z.string().trim().max(2000) }).strict() }),
  ah(async (req, res) => {
    const ids = String(req.query.stores)
      .split(',')
      .map((x) => x.trim())
      .filter((x) => idParam.safeParse(x).success)
      .slice(0, 30);
    if (!ids.length) return res.json({ success: true, data: { points: [] } });
    const r = await pool.query(
      `SELECT id, merchant_id, name, description, city, address, hours, lat, lng FROM ${S}.pickup_points WHERE merchant_id = ANY($1) AND active ORDER BY sort, created_at`,
      [ids],
    );
    res.json({ success: true, data: { points: r.rows } });
  }),
);

const pickupBody = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(300).optional().nullable(),
    city: z.string().trim().max(60).optional().nullable(),
    address: z.string().trim().max(200).optional().nullable(),
    hours: z.string().trim().max(120).optional().nullable(),
    lat: z.number().min(-90).max(90).optional().nullable(),
    lng: z.number().min(-180).max(180).optional().nullable(),
    active: z.boolean().optional(),
  })
  .strict();

merchantRouter.get(
  '/pickup-points',
  ah(async (req, res) => {
    const m = await myMerchant(req);
    const r = await pool.query(`SELECT * FROM ${S}.pickup_points WHERE merchant_id = $1 ORDER BY sort, created_at`, [m.id]);
    res.json({ success: true, data: { points: r.rows } });
  }),
);

merchantRouter.post(
  '/pickup-points',
  validate({ body: pickupBody }),
  ah(async (req, res) => {
    const m = await myMerchant(req);
    const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.pickup_points WHERE merchant_id = $1`, [m.id]);
    if ((n?.n ?? 0) >= 30) throw conflict('PICKUP_LIMIT', 'You can have up to 30 pickup points per store');
    const b = req.body;
    const r = await one(
      `INSERT INTO ${S}.pickup_points (merchant_id, name, description, city, address, hours, lat, lng, active, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,true),$10) RETURNING *`,
      [m.id, b.name, b.description ?? null, b.city ?? null, b.address ?? null, b.hours ?? null, b.lat ?? null, b.lng ?? null, b.active ?? null, n?.n ?? 0],
    );
    res.status(201).json({ success: true, data: { point: r } });
  }),
);

merchantRouter.patch(
  '/pickup-points/:id',
  validate({ params: z.object({ id: idParam }).strict(), body: pickupBody.partial().strict() }),
  ah(async (req, res) => {
    const m = await myMerchant(req);
    const b = req.body;
    const cols: Record<string, string> = { name: 'name', description: 'description', city: 'city', address: 'address', hours: 'hours', lat: 'lat', lng: 'lng', active: 'active' };
    const sets: string[] = [];
    const vals: unknown[] = [req.params.id, m.id];
    for (const [k, v] of Object.entries(b)) {
      if (!cols[k] || v === undefined) continue;
      vals.push(v);
      sets.push(`${cols[k]} = $${vals.length}`);
    }
    if (sets.length) {
      const r = await pool.query(`UPDATE ${S}.pickup_points SET ${sets.join(', ')} WHERE id = $1 AND merchant_id = $2`, vals);
      if (!r.rowCount) throw notFound('Pickup point not found');
    }
    res.json({ success: true });
  }),
);

merchantRouter.delete(
  '/pickup-points/:id',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const m = await myMerchant(req);
    const r = await pool.query(`DELETE FROM ${S}.pickup_points WHERE id = $1 AND merchant_id = $2`, [req.params.id, m.id]);
    if (!r.rowCount) throw notFound('Pickup point not found');
    res.json({ success: true });
  }),
);

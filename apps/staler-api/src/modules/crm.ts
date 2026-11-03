import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { one, pool, S } from '../lib/db.js';
import { badRequest, notFound, tooMany } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { validate } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { amountSchema, fromCents, toCents } from '../lib/money.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { myMerchant } from './commerce.js';
import { notifyBi } from './walletCore.js';
import { GOVERNORATES } from '../lib/places.js';

// Same as commerce's idParam (kept here: commerce imports this module).
const idParam = z.string().regex(/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|\d{1,18})$/, 'Invalid id');

/**
 * A store and its customers: who buys, who is loyal, announcements to them,
 * occasion offers, loyalty discounts and gifts packed with orders. Settings live
 * on the MAIN store; branches share them.
 */

/** Orders that count as real purchases (paid, not cancelled or refunded). */
const REAL = `o.payment_status = 'completed' AND COALESCE(o.status,'') NOT IN ('cancelled','refunded')`;
const inStore = (alias = 'b') => `(${alias}.id = $1 OR ${alias}.parent_id = $1)`;

export const mainOf = (m: { id: string; parent_id?: string | null }) => String(m.parent_id ?? m.id);

// ------------------------------------------------------------------ perks
export interface Perks {
  percent: number;
  note: string | null;
  noteAr: string | null;
  loyal: boolean;
  priorOrders: number;
  gifts: string[];
}

/**
 * What a buyer gets from a store on an order of `fullCents`: the best single
 * discount (an occasion offer or the loyalty discount, whichever is larger) and
 * every gift whose rule matches.
 */
export async function perksFor(c: pg.PoolClient | undefined, mainId: string, userId: string, fullCents: bigint): Promise<Perks> {
  const prior = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${S}.orders o JOIN ${S}.merchants b ON b.id = o.merchant_id WHERE ${inStore()} AND o.user_id = $2 AND ${REAL}`,
    [mainId, userId],
    c,
  );
  const priorOrders = prior?.n ?? 0;
  const p = await one<any>(`SELECT loyal_after, loyal_discount FROM ${S}.store_perks WHERE merchant_id = $1`, [mainId], c);
  const loyal = !!p?.loyal_after && priorOrders >= Number(p.loyal_after);
  let percent = 0;
  let note: string | null = null;
  let noteAr: string | null = null;
  if (loyal && Number(p.loyal_discount) > 0) {
    percent = Number(p.loyal_discount);
    note = 'Loyal customer discount';
    noteAr = 'خصم الزبون المميز';
  }
  const promos = await pool.query(
    `SELECT name, percent, audience, min_total FROM ${S}.store_promos
      WHERE merchant_id = $1 AND active AND starts_at <= now() AND ends_at > now() ORDER BY percent DESC`,
    [mainId],
  );
  for (const pr of promos.rows) {
    if (pr.audience === 'loyal' && !loyal) continue;
    if (toCents(pr.min_total) > fullCents) continue;
    if (Number(pr.percent) > percent) {
      percent = Number(pr.percent);
      note = pr.name;
      noteAr = pr.name;
    }
    break;
  }
  const rules = await pool.query(
    `SELECT gift, rule, threshold FROM ${S}.store_gift_rules WHERE merchant_id = $1 AND active AND (ends_at IS NULL OR ends_at > now()) ORDER BY created_at`,
    [mainId],
  );
  const gifts: string[] = [];
  for (const g of rules.rows) {
    const ok =
      g.rule === 'every' ||
      (g.rule === 'first' && priorOrders === 0) ||
      (g.rule === 'loyal' && loyal) ||
      (g.rule === 'min_total' && g.threshold != null && fullCents >= toCents(g.threshold));
    if (ok) gifts.push(g.gift);
  }
  return { percent, note, noteAr, loyal, priorOrders, gifts };
}

/** Cents off `full` for a percentage (rounded down, never below zero). */
export const discountCents = (full: bigint, percent: number) => (percent > 0 ? (full * BigInt(Math.round(percent * 100))) / 10000n : 0n);

// --------------------------------------------------------- customer side
/** The stores (main ids) where this person is an approved wholesale buyer. */
export async function wholesaleFor(c: pg.PoolClient | undefined, userId: string, mainIds: string[]) {
  if (!mainIds.length) return new Set<string>();
  const r = await (c ?? pool).query(
    `SELECT b.merchant_id FROM ${S}.store_wholesale_buyers b JOIN ${S}.merchants m ON m.id = b.merchant_id
      WHERE b.user_id = $1 AND b.status = 'approved' AND m.wholesale_enabled AND b.merchant_id = ANY($2::uuid[])`,
    [userId, mainIds],
  );
  return new Set(r.rows.map((x) => String(x.merchant_id)));
}

export const followRouter = Router();
followRouter.use(requireAuth);

/** Stores I bought from or follow, and whether their announcements reach me. */
followRouter.get(
  '/following',
  ah(async (req, res) => {
    const r = await pool.query(
      `WITH bought AS (
         SELECT COALESCE(b.parent_id, b.id) AS mid, count(*)::int AS orders, max(o.created_at) AS last_at
           FROM ${S}.orders o JOIN ${S}.merchants b ON b.id = o.merchant_id
          WHERE o.user_id = $1 AND ${REAL} GROUP BY 1
       ), mine AS (
         SELECT merchant_id AS mid, notify FROM ${S}.store_followers WHERE user_id = $1
       )
       SELECT m.id, m.slug, m.store_name, m.logo_url, m.accent, m.category, m.city,
              COALESCE(bought.orders, 0) AS orders, bought.last_at, COALESCE(mine.notify, bought.mid IS NOT NULL) AS notify,
              (mine.mid IS NOT NULL) AS following
         FROM ${S}.merchants m
         LEFT JOIN bought ON bought.mid = m.id
         LEFT JOIN mine ON mine.mid = m.id
        WHERE (bought.mid IS NOT NULL OR mine.mid IS NOT NULL) AND COALESCE(m.status,'active') = 'active'
        ORDER BY COALESCE(bought.last_at, now()) DESC`,
      [req.auth!.userId],
    );
    res.json({ success: true, data: { stores: r.rows } });
  }),
);

/** Turn a store's announcements on (follow) or off (mute). */
followRouter.put(
  '/follow/:merchantId',
  validate({ params: z.object({ merchantId: idParam }).strict(), body: z.object({ notify: z.boolean() }).strict() }),
  ah(async (req, res) => {
    const m = await one<any>(`SELECT id, parent_id FROM ${S}.merchants WHERE id = $1 AND COALESCE(status,'active') = 'active'`, [req.params.merchantId]);
    if (!m) throw notFound('Store not found');
    const mid = mainOf(m);
    await pool.query(
      `INSERT INTO ${S}.store_followers (merchant_id, user_id, notify) VALUES ($1, $2, $3)
       ON CONFLICT (merchant_id, user_id) DO UPDATE SET notify = EXCLUDED.notify, updated_at = now()`,
      [mid, req.auth!.userId, req.body.notify],
    );
    res.json({ success: true, data: { notify: req.body.notify } });
  }),
);

/** What this store offers me right now: its offer, loyalty and gifts — for the store page. */
followRouter.get(
  '/perks/:merchantId',
  validate({ params: z.object({ merchantId: idParam }).strict() }),
  ah(async (req, res) => {
    const m = await one<any>(`SELECT id, parent_id FROM ${S}.merchants WHERE id = $1`, [req.params.merchantId]);
    if (!m) throw notFound('Store not found');
    const mid = mainOf(m);
    const perks = await perksFor(undefined, mid, req.auth!.userId, 0n);
    const p = await one<any>(`SELECT loyal_after, loyal_discount FROM ${S}.store_perks WHERE merchant_id = $1`, [mid]);
    const promo = await one<any>(
      `SELECT name, percent, audience, min_total, ends_at FROM ${S}.store_promos WHERE merchant_id = $1 AND active AND starts_at <= now() AND ends_at > now() ORDER BY percent DESC LIMIT 1`,
      [mid],
    );
    const f = await one<any>(`SELECT notify FROM ${S}.store_followers WHERE merchant_id = $1 AND user_id = $2`, [mid, req.auth!.userId]);
    const ws = await one<any>(
      `SELECT m.wholesale_enabled, m.wholesale_terms, b.status, b.business_name FROM ${S}.merchants m
         LEFT JOIN ${S}.store_wholesale_buyers b ON b.merchant_id = m.id AND b.user_id = $2 WHERE m.id = $1`,
      [mid, req.auth!.userId],
    );
    // Approved trade buyers see the wholesale prices of this store's products.
    const prices =
      ws?.wholesale_enabled && ws.status === 'approved'
        ? (
            await pool.query(
              `SELECT p.id, p.wholesale_price, p.wholesale_min_qty FROM ${S}.products p JOIN ${S}.merchants b ON b.id = p.merchant_id
                WHERE COALESCE(b.parent_id, b.id) = $1 AND p.wholesale_price IS NOT NULL AND COALESCE(p.status,'active') = 'active'`,
              [mid],
            )
          ).rows.reduce((o: Record<string, unknown>, x) => ((o[x.id] = { price: x.wholesale_price, min: x.wholesale_min_qty }), o), {})
        : {};
    res.json({
      success: true,
      data: {
        mainId: mid,
        wholesale: ws?.wholesale_enabled ? { terms: ws.wholesale_terms, status: ws.status ?? null, businessName: ws.business_name ?? null, prices } : null,
        notify: f ? f.notify : perks.priorOrders > 0,
        following: !!f,
        orders: perks.priorOrders,
        loyal: perks.loyal,
        loyalAfter: p?.loyal_after ?? null,
        loyalDiscount: p ? Number(p.loyal_discount) : 0,
        promo,
      },
    });
  }),
);

/** Discounts and gifts the cart would get, per store, before paying. */
followRouter.post(
  '/quote',
  validate({ body: z.object({ items: z.array(z.object({ productId: idParam, quantity: z.number().int().min(1).max(100) }).strict()).min(1).max(50) }).strict() }),
  ah(async (req, res) => {
    const ids = req.body.items.map((i: any) => i.productId);
    const r = await pool.query(
      `SELECT p.id, p.price, p.wholesale_price, p.wholesale_min_qty, COALESCE(m.parent_id, m.id) AS mid FROM ${S}.products p JOIN ${S}.merchants m ON m.id = p.merchant_id WHERE p.id = ANY($1)`,
      [ids],
    );
    const trade = await wholesaleFor(undefined, req.auth!.userId, [...new Set(r.rows.map((x) => String(x.mid)))]);
    const full = new Map<string, bigint>();
    const wholesale = new Set<string>();
    for (const it of req.body.items) {
      const p = r.rows.find((x) => String(x.id) === String(it.productId));
      if (!p) continue;
      const ws = p.wholesale_price != null && trade.has(String(p.mid)) && it.quantity >= Number(p.wholesale_min_qty ?? 1);
      if (ws) wholesale.add(String(p.mid));
      full.set(String(p.mid), (full.get(String(p.mid)) ?? 0n) + toCents(ws ? p.wholesale_price : p.price) * BigInt(it.quantity));
    }
    const stores: any[] = [];
    for (const [mid, cents] of full) {
      if (wholesale.has(mid)) {
        stores.push({ mainId: mid, full: fromCents(cents), discount: '0.00', percent: 0, note: null, loyal: false, gifts: [], wholesale: true });
        continue;
      }
      const pk = await perksFor(undefined, mid, req.auth!.userId, cents);
      const off = discountCents(cents, pk.percent);
      stores.push({ mainId: mid, full: fromCents(cents), discount: fromCents(off), percent: pk.percent, note: pk.note, loyal: pk.loyal, gifts: pk.gifts });
    }
    res.json({ success: true, data: { stores } });
  }),
);

/** Ask a store to deal with you as a wholesale (trade) buyer. */
followRouter.post(
  '/wholesale/:merchantId',
  validate({
    params: z.object({ merchantId: idParam }).strict(),
    body: z.object({ businessName: z.string().trim().min(2).max(80), note: z.string().trim().max(400).optional() }).strict(),
  }),
  ah(async (req, res) => {
    const m = await one<any>(`SELECT id, parent_id, user_id, wholesale_enabled, store_name FROM ${S}.merchants WHERE id = $1`, [req.params.merchantId]);
    if (!m) throw notFound('Store not found');
    const main = m.parent_id ? await one<any>(`SELECT id, user_id, wholesale_enabled, store_name FROM ${S}.merchants WHERE id = $1`, [m.parent_id]) : m;
    if (!main.wholesale_enabled) throw badRequest('NO_WHOLESALE', 'This store doesn’t sell wholesale');
    if (String(main.user_id) === String(req.auth!.userId)) throw badRequest('OWN_STORE', 'This is your own store');
    const r = await one<any>(
      `INSERT INTO ${S}.store_wholesale_buyers (merchant_id, user_id, business_name, note) VALUES ($1, $2, $3, $4)
       ON CONFLICT (merchant_id, user_id) DO UPDATE SET business_name = EXCLUDED.business_name, note = EXCLUDED.note,
         status = CASE WHEN ${S}.store_wholesale_buyers.status = 'approved' THEN 'approved' ELSE 'pending' END, created_at = now()
       RETURNING status`,
      [main.id, req.auth!.userId, req.body.businessName, req.body.note ?? null],
    );
    if (r.status === 'pending')
      await notifyBi(undefined, main.user_id, 'wholesale_request', ['New wholesale request', `${req.body.businessName} wants to buy wholesale.`], ['طلب تعامل جملة', `${req.body.businessName} بدّه يشتري منك جملة.`], {
        link: '/app/merchant/customers?tab=wholesale',
      });
    res.json({ success: true, data: { status: r.status } });
  }),
);

// --------------------------------------------------------- merchant side
export const crmRouter = Router();
crmRouter.use(requireAuth, requireRole('merchant'));

async function mainStore(req: any) {
  const m = await myMerchant(req);
  const main = m.parent_id ? await one<any>(`SELECT * FROM ${S}.merchants WHERE id = $1`, [m.parent_id]) : m;
  return main;
}

/** Customers of the store with how often and how much they bought. */
crmRouter.get(
  '/customers',
  validate({
    query: z
      .object({
        q: z.string().trim().max(60).optional(),
        sort: z.enum(['spent', 'orders', 'recent']).default('spent'),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const m = await mainStore(req);
    const q = req.query as any;
    const order = q.sort === 'orders' ? 'orders DESC, spent DESC' : q.sort === 'recent' ? 'last_at DESC' : 'spent DESC, orders DESC';
    const p = await one<any>(`SELECT loyal_after FROM ${S}.store_perks WHERE merchant_id = $1`, [m.id]);
    const r = await pool.query(
      `SELECT u.id, u.full_name, u.profile_image, count(*)::int AS orders,
              COALESCE(sum(o.total_amount), 0)::text AS spent,
              max(o.created_at) AS last_at, min(o.created_at) AS first_at,
              COALESCE(f.notify, true) AS notify
         FROM ${S}.orders o JOIN ${S}.merchants b ON b.id = o.merchant_id JOIN ${S}.users u ON u.id = o.user_id
         LEFT JOIN ${S}.store_followers f ON f.merchant_id = $1 AND f.user_id = u.id
        WHERE ${inStore()} AND ${REAL} AND ($2::text IS NULL OR u.full_name ILIKE $2)
        GROUP BY u.id, f.notify
        ORDER BY ${order} LIMIT $3`,
      [m.id, q.q ? `%${String(q.q).replace(/[\\%_]/g, (c: string) => `\\${c}`)}%` : null, q.limit],
    );
    const loyalAfter = p?.loyal_after ?? null;
    res.json({ success: true, data: { customers: r.rows.map((x) => ({ ...x, loyal: !!loyalAfter && x.orders >= loyalAfter })), loyalAfter } });
  }),
);

/** The store at a glance: customers, repeat buyers, revenue, and the best customers. */
crmRouter.get(
  '/insights',
  ah(async (req, res) => {
    const m = await mainStore(req);
    const p = await one<any>(`SELECT loyal_after, loyal_discount FROM ${S}.store_perks WHERE merchant_id = $1`, [m.id]);
    const s = await one<any>(
      `WITH c AS (
         SELECT o.user_id, count(*)::int AS n, sum(o.total_amount) AS spent
           FROM ${S}.orders o JOIN ${S}.merchants b ON b.id = o.merchant_id WHERE ${inStore()} AND ${REAL} GROUP BY o.user_id
       )
       SELECT count(*)::int AS customers, count(*) FILTER (WHERE n >= 2)::int AS repeat,
              count(*) FILTER (WHERE $2::int IS NOT NULL AND n >= $2)::int AS loyal,
              COALESCE(sum(n), 0)::int AS orders, COALESCE(sum(spent), 0)::text AS revenue
         FROM c`,
      [m.id, p?.loyal_after ?? null],
    );
    const recent = await one<any>(
      `SELECT count(*)::int AS orders, COALESCE(sum(o.total_amount), 0)::text AS revenue,
              COALESCE(sum(o.discount_amount), 0)::text AS discounts
         FROM ${S}.orders o JOIN ${S}.merchants b ON b.id = o.merchant_id WHERE ${inStore()} AND ${REAL} AND o.created_at > now() - interval '30 days'`,
      [m.id],
    );
    const follow = await one<any>(
      `SELECT count(*) FILTER (WHERE notify)::int AS following, count(*) FILTER (WHERE NOT notify)::int AS muted FROM ${S}.store_followers WHERE merchant_id = $1`,
      [m.id],
    );
    const top = async (order: string) =>
      (
        await pool.query(
          `SELECT u.id, u.full_name, u.profile_image, count(*)::int AS orders, sum(o.total_amount)::text AS spent
             FROM ${S}.orders o JOIN ${S}.merchants b ON b.id = o.merchant_id JOIN ${S}.users u ON u.id = o.user_id
            WHERE ${inStore()} AND ${REAL} GROUP BY u.id ORDER BY ${order} LIMIT 5`,
          [m.id],
        )
      ).rows;
    res.json({
      success: true,
      data: {
        store: { id: m.id, name: m.store_name },
        totals: s,
        last30: recent,
        followers: follow,
        loyalAfter: p?.loyal_after ?? null,
        loyalDiscount: p ? Number(p.loyal_discount) : 0,
        topSpenders: await top('sum(o.total_amount) DESC'),
        topFrequent: await top('count(*) DESC, max(o.created_at) DESC'),
      },
    });
  }),
);

// Loyalty settings
crmRouter.get(
  '/perks',
  ah(async (req, res) => {
    const m = await mainStore(req);
    const p = await one<any>(`SELECT loyal_after, loyal_discount FROM ${S}.store_perks WHERE merchant_id = $1`, [m.id]);
    const promos = await pool.query(`SELECT * FROM ${S}.store_promos WHERE merchant_id = $1 ORDER BY (ends_at > now()) DESC, starts_at DESC LIMIT 50`, [m.id]);
    const gifts = await pool.query(`SELECT * FROM ${S}.store_gift_rules WHERE merchant_id = $1 ORDER BY active DESC, created_at DESC`, [m.id]);
    res.json({ success: true, data: { loyalAfter: p?.loyal_after ?? null, loyalDiscount: p ? Number(p.loyal_discount) : 0, promos: promos.rows, gifts: gifts.rows } });
  }),
);

crmRouter.put(
  '/loyalty',
  validate({ body: z.object({ loyalAfter: z.number().int().min(2).max(1000).nullable(), loyalDiscount: z.number().min(0).max(90) }).strict() }),
  ah(async (req, res) => {
    const m = await mainStore(req);
    await pool.query(
      `INSERT INTO ${S}.store_perks (merchant_id, loyal_after, loyal_discount) VALUES ($1, $2, $3)
       ON CONFLICT (merchant_id) DO UPDATE SET loyal_after = EXCLUDED.loyal_after, loyal_discount = EXCLUDED.loyal_discount, updated_at = now()`,
      [m.id, req.body.loyalAfter, req.body.loyalDiscount],
    );
    await audit({ userId: req.auth!.userId, action: 'merchant.loyalty_set', entityType: 'merchant', entityId: m.id, details: req.body }, req);
    res.json({ success: true });
  }),
);

const promoBody = z
  .object({
    name: z.string().trim().min(2).max(60),
    percent: z.number().min(1).max(90),
    audience: z.enum(['all', 'loyal']).default('all'),
    minTotal: amountSchema.optional(),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }),
  })
  .strict();

crmRouter.post(
  '/promos',
  validate({ body: promoBody }),
  ah(async (req, res) => {
    const m = await mainStore(req);
    const b = req.body;
    const start = b.startsAt ? new Date(b.startsAt) : new Date();
    if (new Date(b.endsAt) <= start) throw badRequest('BAD_DATES', 'The offer must end after it starts');
    const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.store_promos WHERE merchant_id = $1 AND active AND ends_at > now()`, [m.id]);
    if ((n?.n ?? 0) >= 10) throw badRequest('TOO_MANY_OFFERS', 'You can have up to 10 running offers');
    const r = await one<any>(
      `INSERT INTO ${S}.store_promos (merchant_id, name, percent, audience, min_total, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [m.id, b.name, b.percent, b.audience, b.minTotal ?? '0', start.toISOString(), b.endsAt],
    );
    await audit({ userId: req.auth!.userId, action: 'merchant.offer_created', entityType: 'merchant', entityId: m.id, details: { name: b.name, percent: b.percent } }, req);
    res.status(201).json({ success: true, data: { promo: r } });
  }),
);

crmRouter.patch(
  '/promos/:id',
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ active: z.boolean() }).strict() }),
  ah(async (req, res) => {
    const m = await mainStore(req);
    const r = await pool.query(`UPDATE ${S}.store_promos SET active = $3 WHERE id = $1 AND merchant_id = $2`, [req.params.id, m.id, req.body.active]);
    if (!r.rowCount) throw notFound('Offer not found');
    res.json({ success: true });
  }),
);

crmRouter.delete(
  '/promos/:id',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const m = await mainStore(req);
    await pool.query(`DELETE FROM ${S}.store_promos WHERE id = $1 AND merchant_id = $2`, [req.params.id, m.id]);
    res.json({ success: true });
  }),
);

const giftBody = z
  .object({
    gift: z.string().trim().min(2).max(80),
    rule: z.enum(['every', 'first', 'loyal', 'min_total']),
    threshold: amountSchema.optional(),
    endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();

crmRouter.post(
  '/gifts',
  validate({ body: giftBody }),
  ah(async (req, res) => {
    const m = await mainStore(req);
    const b = req.body;
    if (b.rule === 'min_total' && !b.threshold) throw badRequest('THRESHOLD_REQUIRED', 'Set the order amount for this gift');
    const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.store_gift_rules WHERE merchant_id = $1 AND active`, [m.id]);
    if ((n?.n ?? 0) >= 10) throw badRequest('TOO_MANY_GIFTS', 'You can have up to 10 gift rules');
    const r = await one<any>(
      `INSERT INTO ${S}.store_gift_rules (merchant_id, gift, rule, threshold, ends_at) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [m.id, b.gift, b.rule, b.rule === 'min_total' ? b.threshold : null, b.endsAt ?? null],
    );
    res.status(201).json({ success: true, data: { gift: r } });
  }),
);

crmRouter.patch(
  '/gifts/:id',
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ active: z.boolean() }).strict() }),
  ah(async (req, res) => {
    const m = await mainStore(req);
    const r = await pool.query(`UPDATE ${S}.store_gift_rules SET active = $3 WHERE id = $1 AND merchant_id = $2`, [req.params.id, m.id, req.body.active]);
    if (!r.rowCount) throw notFound('Gift not found');
    res.json({ success: true });
  }),
);

crmRouter.delete(
  '/gifts/:id',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const m = await mainStore(req);
    await pool.query(`DELETE FROM ${S}.store_gift_rules WHERE id = $1 AND merchant_id = $2`, [req.params.id, m.id]);
    res.json({ success: true });
  }),
);

// Announcements to the store's customers
/** Who an announcement reaches: buyers and followers who haven't muted the store. */
function audienceSql(kind: 'all' | 'loyal' | 'people' | 'wholesale') {
  if (kind === 'wholesale')
    return `SELECT b.user_id AS uid FROM ${S}.store_wholesale_buyers b JOIN ${S}.users u ON u.id = b.user_id AND u.status = 'active'
             WHERE b.merchant_id = $1 AND b.status = 'approved'`;
  const buyers = `SELECT o.user_id AS uid, count(*)::int AS n FROM ${S}.orders o JOIN ${S}.merchants b ON b.id = o.merchant_id WHERE ${inStore()} AND ${REAL} GROUP BY o.user_id`;
  const base = `WITH buyers AS (${buyers}),
    pool AS (
      SELECT uid, n FROM buyers
      UNION SELECT f.user_id, 0 FROM ${S}.store_followers f WHERE f.merchant_id = $1 AND f.notify AND f.user_id NOT IN (SELECT uid FROM buyers)
    )
    SELECT DISTINCT p.uid FROM pool p JOIN ${S}.users u ON u.id = p.uid AND u.status = 'active'
     WHERE NOT EXISTS (SELECT 1 FROM ${S}.store_followers m WHERE m.merchant_id = $1 AND m.user_id = p.uid AND NOT m.notify)`;
  if (kind === 'loyal') return `${base} AND p.n >= $2::int`;
  if (kind === 'people') return `${base} AND p.uid = ANY($2::uuid[])`;
  return base;
}

const announceBody = z
  .object({
    title: z.string().trim().min(2).max(80),
    body: z.string().trim().min(2).max(500),
    tone: z.enum(['news', 'offer', 'gift']).default('news'),
    audience: z.enum(['all', 'loyal', 'people', 'wholesale']).default('all'),
    userIds: z.array(idParam).max(200).optional(),
    dryRun: z.boolean().default(false),
  })
  .strict();

crmRouter.post(
  '/announce',
  validate({ body: announceBody }),
  ah(async (req, res) => {
    const m = await mainStore(req);
    const b = req.body as z.infer<typeof announceBody>;
    const p = await one<any>(`SELECT loyal_after FROM ${S}.store_perks WHERE merchant_id = $1`, [m.id]);
    if (b.audience === 'loyal' && !p?.loyal_after) throw badRequest('NO_LOYALTY', 'Set when a customer becomes loyal first');
    if (b.audience === 'people' && !b.userIds?.length) throw badRequest('NO_AUDIENCE', 'Choose who should get it');
    const params = b.audience === 'loyal' ? [m.id, p.loyal_after] : b.audience === 'people' ? [m.id, b.userIds] : [m.id];
    const who = await pool.query(audienceSql(b.audience), params);
    if (b.dryRun) return res.json({ success: true, data: { count: who.rowCount } });
    const today = await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.store_announcements WHERE merchant_id = $1 AND created_at > now() - interval '1 day'`, [m.id]);
    if ((today?.n ?? 0) >= 5) throw tooMany('You can send up to 5 announcements a day', 'ANNOUNCE_LIMIT');
    for (const row of who.rows) {
      await notifyBi(
        undefined,
        row.uid,
        'store_news',
        [`${m.store_name}: ${b.title}`, b.body],
        [`${m.store_name}: ${b.title}`, b.body],
        { merchantId: m.id, slug: m.slug, tone: b.tone },
      );
    }
    await pool.query(
      `INSERT INTO ${S}.store_announcements (merchant_id, title, body, tone, audience, sent_count) VALUES ($1, $2, $3, $4, $5, $6)`,
      [m.id, b.title, b.body, b.tone, b.audience, who.rowCount ?? 0],
    );
    await audit({ userId: req.auth!.userId, action: 'merchant.announced', entityType: 'merchant', entityId: m.id, details: { title: b.title, count: who.rowCount } }, req);
    res.json({ success: true, data: { sent: who.rowCount } });
  }),
);

crmRouter.get(
  '/announcements',
  ah(async (req, res) => {
    const m = await mainStore(req);
    const r = await pool.query(`SELECT * FROM ${S}.store_announcements WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 50`, [m.id]);
    res.json({ success: true, data: { items: r.rows } });
  }),
);

// ---------------------------------------------------------------- wholesale
/** Wholesale settings and the trade buyers who asked or were approved. */
crmRouter.get(
  '/wholesale',
  ah(async (req, res) => {
    const m = await mainStore(req);
    const r = await pool.query(
      `SELECT b.user_id AS id, b.status, b.business_name, b.note, b.created_at, b.decided_at, u.full_name, u.profile_image, u.role,
              (SELECT count(*)::int FROM ${S}.orders o JOIN ${S}.merchants x ON x.id = o.merchant_id WHERE COALESCE(x.parent_id, x.id) = $1 AND o.user_id = b.user_id AND o.is_wholesale AND ${REAL}) AS orders,
              (SELECT COALESCE(sum(o.total_amount), 0)::text FROM ${S}.orders o JOIN ${S}.merchants x ON x.id = o.merchant_id WHERE COALESCE(x.parent_id, x.id) = $1 AND o.user_id = b.user_id AND o.is_wholesale AND ${REAL}) AS spent
         FROM ${S}.store_wholesale_buyers b JOIN ${S}.users u ON u.id = b.user_id
        WHERE b.merchant_id = $1 ORDER BY (b.status = 'pending') DESC, b.created_at DESC`,
      [m.id],
    );
    const n = await one<any>(
      `SELECT count(*)::int AS n FROM ${S}.products p JOIN ${S}.merchants x ON x.id = p.merchant_id WHERE COALESCE(x.parent_id, x.id) = $1 AND p.wholesale_price IS NOT NULL AND COALESCE(p.status,'active') = 'active'`,
      [m.id],
    );
    res.json({ success: true, data: { enabled: m.wholesale_enabled, terms: m.wholesale_terms, products: n?.n ?? 0, buyers: r.rows } });
  }),
);

crmRouter.put(
  '/wholesale',
  validate({ body: z.object({ enabled: z.boolean(), terms: z.string().trim().max(1500).nullable().optional() }).strict() }),
  ah(async (req, res) => {
    const m = await mainStore(req);
    await pool.query(`UPDATE ${S}.merchants SET wholesale_enabled = $2, wholesale_terms = $3 WHERE id = $1`, [m.id, req.body.enabled, req.body.terms || null]);
    res.json({ success: true });
  }),
);

crmRouter.post(
  '/wholesale/:userId/:decision',
  validate({ params: z.object({ userId: idParam, decision: z.enum(['approve', 'reject', 'remove']) }).strict() }),
  ah(async (req, res) => {
    const m = await mainStore(req);
    const d = req.params.decision;
    const r =
      d === 'remove'
        ? await pool.query(`DELETE FROM ${S}.store_wholesale_buyers WHERE merchant_id = $1 AND user_id = $2`, [m.id, req.params.userId])
        : await pool.query(`UPDATE ${S}.store_wholesale_buyers SET status = $3, decided_at = now() WHERE merchant_id = $1 AND user_id = $2`, [
            m.id,
            req.params.userId,
            d === 'approve' ? 'approved' : 'rejected',
          ]);
    if (!r.rowCount) throw notFound('Request not found');
    if (d !== 'remove')
      await notifyBi(
        undefined,
        req.params.userId!,
        'wholesale_decided',
        d === 'approve' ? [`${m.store_name}: wholesale approved`, 'You now see wholesale prices in this store.'] : [`${m.store_name}: wholesale request declined`, ''],
        d === 'approve' ? [`${m.store_name}: انقبلت كتاجر جملة`, 'صرت تشوف أسعار الجملة بهالمتجر.'] : [`${m.store_name}: ما انقبل طلب الجملة`, ''],
        { link: `/s/${m.slug}` },
      );
    res.json({ success: true });
  }),
);

// ----------------------------------------------------------------- sections
const sectionBody = z.object({ name: z.string().trim().min(1).max(40), icon: z.string().trim().max(24).nullable().optional(), imageUrl: z.string().max(500).nullable().optional() }).strict();
const fileUrl = (u: string | null | undefined) => !u || u.startsWith('/files/') || /^https:\/\/[a-z0-9.-]+\.supabase\.co\/storage\//i.test(u);

/** The store's own product sections (shared by its branches). */
crmRouter.get(
  '/sections',
  ah(async (req, res) => {
    const m = await mainStore(req);
    const r = await pool.query(
      `SELECT s.id, s.name, s.icon, s.image_url, s.sort,
              (SELECT count(*)::int FROM ${S}.products p JOIN ${S}.merchants x ON x.id = p.merchant_id
                WHERE s.id = ANY(p.section_ids) AND COALESCE(x.parent_id, x.id) = $1 AND COALESCE(p.status,'active') <> 'deleted') AS count
         FROM ${S}.store_sections s WHERE s.merchant_id = $1 ORDER BY s.sort, s.created_at`,
      [m.id],
    );
    res.json({ success: true, data: { sections: r.rows } });
  }),
);

crmRouter.post(
  '/sections',
  validate({ body: sectionBody }),
  ah(async (req, res) => {
    const m = await mainStore(req);
    if (!fileUrl(req.body.imageUrl)) throw badRequest('BAD_IMAGE', 'Upload the image first');
    const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.store_sections WHERE merchant_id = $1`, [m.id]);
    if ((n?.n ?? 0) >= 40) throw badRequest('TOO_MANY_SECTIONS', 'Up to 40 sections');
    const r = await one(
      `INSERT INTO ${S}.store_sections (merchant_id, name, icon, image_url, sort) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, icon, image_url, sort`,
      [m.id, req.body.name, req.body.icon ?? null, req.body.imageUrl ?? null, n?.n ?? 0],
    );
    res.status(201).json({ success: true, data: { section: r } });
  }),
);

crmRouter.put(
  '/sections/:id',
  validate({ params: z.object({ id: idParam }).strict(), body: sectionBody }),
  ah(async (req, res) => {
    const m = await mainStore(req);
    if (!fileUrl(req.body.imageUrl)) throw badRequest('BAD_IMAGE', 'Upload the image first');
    const r = await pool.query(`UPDATE ${S}.store_sections SET name = $3, icon = $4, image_url = $5 WHERE id = $1 AND merchant_id = $2`, [
      req.params.id,
      m.id,
      req.body.name,
      req.body.icon ?? null,
      req.body.imageUrl ?? null,
    ]);
    if (!r.rowCount) throw notFound('Section not found');
    res.json({ success: true });
  }),
);

crmRouter.delete(
  '/sections/:id',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const m = await mainStore(req);
    const r = await pool.query(`DELETE FROM ${S}.store_sections WHERE id = $1 AND merchant_id = $2`, [req.params.id, m.id]);
    if (!r.rowCount) throw notFound('Section not found');
    await pool.query(`UPDATE ${S}.products SET section_ids = array_remove(section_ids, $1::uuid) WHERE $1::uuid = ANY(section_ids)`, [req.params.id]);
    res.json({ success: true });
  }),
);

crmRouter.put(
  '/sections-order',
  validate({ body: z.object({ ids: z.array(idParam).max(40) }).strict() }),
  ah(async (req, res) => {
    const m = await mainStore(req);
    for (const [i, id] of req.body.ids.entries()) await pool.query(`UPDATE ${S}.store_sections SET sort = $3 WHERE id = $1 AND merchant_id = $2`, [id, m.id, i]);
    res.json({ success: true });
  }),
);

/** Put several products in (or out of) a section at once. */
crmRouter.post(
  '/sections/:id/products',
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ add: z.array(idParam).max(500).default([]), remove: z.array(idParam).max(500).default([]) }).strict() }),
  ah(async (req, res) => {
    const m = await mainStore(req);
    if (!(await one(`SELECT 1 FROM ${S}.store_sections WHERE id = $1 AND merchant_id = $2`, [req.params.id, m.id]))) throw notFound('Section not found');
    const mine = `merchant_id IN (SELECT id FROM ${S}.merchants WHERE id = $2 OR parent_id = $2)`;
    if (req.body.add.length)
      await pool.query(`UPDATE ${S}.products SET section_ids = array_append(section_ids, $1::uuid) WHERE ${mine} AND id = ANY($3::uuid[]) AND NOT ($1::uuid = ANY(section_ids))`, [
        req.params.id,
        m.id,
        req.body.add,
      ]);
    if (req.body.remove.length)
      await pool.query(`UPDATE ${S}.products SET section_ids = array_remove(section_ids, $1::uuid) WHERE ${mine} AND id = ANY($3::uuid[])`, [req.params.id, m.id, req.body.remove]);
    res.json({ success: true });
  }),
);

// ---------------------------------------------------------------- analytics
/**
 * Where customers come from, which branch and store they buy at, and what sells —
 * for this store, one branch, or all the owner's stores together.
 */
crmRouter.get(
  '/analytics',
  validate({
    query: z
      .object({
        scope: z.string().trim().max(60).default('store'),
        days: z.coerce.number().int().min(0).max(3650).default(90),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const m = await mainStore(req);
    const q = req.query as any;
    const userId = req.auth!.userId;
    // Which store rows count: this store with its branches, one branch, or every store the owner has.
    let ids: string[];
    if (q.scope === 'all') ids = (await pool.query(`SELECT id FROM ${S}.merchants WHERE user_id = $1`, [userId])).rows.map((x) => String(x.id));
    else if (q.scope.startsWith('branch:')) {
      const b = await one<any>(`SELECT id FROM ${S}.merchants WHERE id = $1 AND (id = $2 OR parent_id = $2)`, [q.scope.slice(7), m.id]);
      if (!b) throw notFound('Branch not found');
      ids = [String(b.id)];
    } else ids = (await pool.query(`SELECT id FROM ${S}.merchants WHERE id = $1 OR parent_id = $1`, [m.id])).rows.map((x) => String(x.id));
    const since = `($2::int = 0 OR o.created_at > now() - make_interval(days => $2::int))`;
    const base = `FROM ${S}.orders o WHERE o.merchant_id = ANY($1::uuid[]) AND ${REAL} AND ${since}`;
    const P = [ids, q.days];
    // A customer's place: the town they gave, else where they last signed in from.
    const placeOf = `COALESCE(NULLIF(btrim(u.home_city), ''),
       (SELECT g.city FROM ${S}.user_device_places dp JOIN ${S}.ip_geo g ON g.ip = dp.ip AND g.ok WHERE dp.user_id = u.id ORDER BY dp.last_seen DESC LIMIT 1))`;
    const [totals, places, branches, stores, products, series] = await Promise.all([
      one<any>(
        `SELECT count(*)::int AS orders, count(DISTINCT o.user_id)::int AS customers, COALESCE(sum(o.total_amount), 0)::text AS revenue,
                COALESCE(round(avg(o.total_amount), 2), 0)::text AS avg_order, count(*) FILTER (WHERE o.is_wholesale)::int AS wholesale_orders,
                COALESCE(sum(o.discount_amount), 0)::text AS discounts ${base}`,
        P,
      ),
      pool.query(
        `SELECT place, count(DISTINCT uid)::int AS customers, count(*)::int AS orders, COALESCE(sum(total), 0)::text AS revenue
           FROM (SELECT o.user_id AS uid, o.total_amount AS total, ${placeOf} AS place
                   FROM ${S}.orders o JOIN ${S}.users u ON u.id = o.user_id
                  WHERE o.merchant_id = ANY($1::uuid[]) AND ${REAL} AND ${since}) t
          GROUP BY place ORDER BY customers DESC, orders DESC`,
        P,
      ),
      pool.query(
        `SELECT b.id, b.store_name, b.branch_name, b.city, (b.parent_id IS NULL) AS is_main,
                count(o.id)::int AS orders, count(DISTINCT o.user_id)::int AS customers, COALESCE(sum(o.total_amount), 0)::text AS revenue,
                (SELECT COALESCE(json_agg(t ORDER BY t.customers DESC), '[]') FROM (
                   SELECT place, count(DISTINCT uid)::int AS customers FROM (
                     SELECT oo.user_id AS uid, ${placeOf.replaceAll('u.', 'uu.')} AS place
                       FROM ${S}.orders oo JOIN ${S}.users uu ON uu.id = oo.user_id
                      WHERE oo.merchant_id = b.id AND ${REAL.replaceAll('o.', 'oo.')} AND ($2::int = 0 OR oo.created_at > now() - make_interval(days => $2::int))) pp
                    GROUP BY place ORDER BY 2 DESC LIMIT 5) t) AS top_places
           FROM ${S}.merchants b LEFT JOIN ${S}.orders o ON o.merchant_id = b.id AND ${REAL} AND ${since}
          WHERE b.id = ANY($1::uuid[]) GROUP BY b.id ORDER BY orders DESC`,
        P,
      ),
      pool.query(
        `SELECT s.*, mm.store_name FROM (
           SELECT COALESCE(b.parent_id, b.id) AS id, count(o.id)::int AS orders, count(DISTINCT o.user_id)::int AS customers, COALESCE(sum(o.total_amount), 0) AS rev
             FROM ${S}.merchants b LEFT JOIN ${S}.orders o ON o.merchant_id = b.id AND ${REAL} AND ${since}
            WHERE b.id = ANY($1::uuid[]) GROUP BY 1) s JOIN ${S}.merchants mm ON mm.id = s.id ORDER BY s.rev DESC`,
        P,
      ),
      pool.query(
        `SELECT oi.product_id AS id, max(oi.product_name) AS name, (SELECT image_url FROM ${S}.products WHERE id = oi.product_id) AS image_url,
                sum(oi.quantity)::int AS units, count(DISTINCT o.id)::int AS orders, count(DISTINCT o.user_id)::int AS buyers,
                COALESCE(sum(oi.price * oi.quantity), 0)::text AS revenue
           FROM ${S}.order_items oi JOIN ${S}.orders o ON o.id = oi.order_id
          WHERE o.merchant_id = ANY($1::uuid[]) AND ${REAL} AND ${since}
          GROUP BY oi.product_id ORDER BY units DESC, revenue DESC LIMIT 50`,
        P,
      ),
      pool.query(
        `SELECT to_char(date_trunc('day', o.created_at), 'YYYY-MM-DD') AS day, count(*)::int AS orders, COALESCE(sum(o.total_amount), 0)::text AS revenue
           ${base} GROUP BY 1 ORDER BY 1`,
        P,
      ),
    ]);
    const myStores = await pool.query(`SELECT id, store_name, branch_name, parent_id, city FROM ${S}.merchants WHERE user_id = $1 ORDER BY parent_id NULLS FIRST, created_at`, [userId]);
    res.json({
      success: true,
      data: {
        scope: q.scope,
        totals,
        places: mergePlaces(places.rows),
        branches: branches.rows.map((b) => ({ ...b, top_places: mergePlaces(b.top_places ?? []) })),
        stores: stores.rows.map(({ rev, ...x }) => ({ ...x, revenue: Number(rev).toFixed(2) })),
        products: products.rows,
        series: series.rows,
        options: { mainId: m.id, stores: myStores.rows },
      },
    });
  }),
);

/** Sign-in places come in English ("Nablus"); show them as the Arabic governorate and add up duplicates. */
export function mergePlaces<T extends { place: string | null; customers?: number; orders?: number; revenue?: string }>(rows: T[]): T[] {
  const out = new Map<string, T>();
  for (const r of rows) {
    const raw = (r.place ?? '').trim();
    const g = raw && /^[A-Za-z]/.test(raw) ? GOVERNORATES.find((x) => x.en.toLowerCase().startsWith(raw.toLowerCase().split(/[ ,]/)[0]!)) : null;
    const key = g ? g.ar : raw || '';
    const prev = out.get(key);
    if (!prev) out.set(key, { ...r, place: key || null });
    else
      out.set(key, {
        ...prev,
        customers: (prev.customers ?? 0) + (r.customers ?? 0),
        orders: (prev.orders ?? 0) + (r.orders ?? 0),
        revenue: prev.revenue != null ? (Number(prev.revenue) + Number(r.revenue ?? 0)).toFixed(2) : undefined,
      });
  }
  return [...out.values()].sort((a, b) => (b.customers ?? 0) - (a.customers ?? 0));
}

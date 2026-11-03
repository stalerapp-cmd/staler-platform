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
    res.json({
      success: true,
      data: {
        mainId: mid,
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
      `SELECT p.id, p.price, COALESCE(m.parent_id, m.id) AS mid FROM ${S}.products p JOIN ${S}.merchants m ON m.id = p.merchant_id WHERE p.id = ANY($1)`,
      [ids],
    );
    const full = new Map<string, bigint>();
    for (const it of req.body.items) {
      const p = r.rows.find((x) => String(x.id) === String(it.productId));
      if (!p) continue;
      full.set(String(p.mid), (full.get(String(p.mid)) ?? 0n) + toCents(p.price) * BigInt(it.quantity));
    }
    const stores: any[] = [];
    for (const [mid, cents] of full) {
      const pk = await perksFor(undefined, mid, req.auth!.userId, cents);
      const off = discountCents(cents, pk.percent);
      stores.push({ mainId: mid, full: fromCents(cents), discount: fromCents(off), percent: pk.percent, note: pk.note, loyal: pk.loyal, gifts: pk.gifts });
    }
    res.json({ success: true, data: { stores } });
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
              COALESCE(sum(o.total_amount - COALESCE(o.discount_amount, 0)), 0)::text AS spent,
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
         SELECT o.user_id, count(*)::int AS n, sum(o.total_amount - COALESCE(o.discount_amount, 0)) AS spent
           FROM ${S}.orders o JOIN ${S}.merchants b ON b.id = o.merchant_id WHERE ${inStore()} AND ${REAL} GROUP BY o.user_id
       )
       SELECT count(*)::int AS customers, count(*) FILTER (WHERE n >= 2)::int AS repeat,
              count(*) FILTER (WHERE $2::int IS NOT NULL AND n >= $2)::int AS loyal,
              COALESCE(sum(n), 0)::int AS orders, COALESCE(sum(spent), 0)::text AS revenue
         FROM c`,
      [m.id, p?.loyal_after ?? null],
    );
    const recent = await one<any>(
      `SELECT count(*)::int AS orders, COALESCE(sum(o.total_amount - COALESCE(o.discount_amount, 0)), 0)::text AS revenue,
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
          `SELECT u.id, u.full_name, u.profile_image, count(*)::int AS orders, sum(o.total_amount - COALESCE(o.discount_amount, 0))::text AS spent
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
        topSpenders: await top('sum(o.total_amount - COALESCE(o.discount_amount, 0)) DESC'),
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
function audienceSql(kind: 'all' | 'loyal' | 'people') {
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
    audience: z.enum(['all', 'loyal', 'people']).default('all'),
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

import { Router } from 'express';
import { z } from 'zod';
import { one, pool, S } from '../lib/db.js';
import { badRequest, conflict, forbidden, notFound, tooMany } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { validate } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { requirePerm } from '../lib/permissions.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { myMerchant } from './commerce.js';
import { mainOf } from './crm.js';
import { maskName, notifyBi } from './walletCore.js';

/**
 * Store reviews and reports.
 *
 * Reviews: one per person per store. Writing again edits it — the earlier versions are
 * kept for the admins, so a store can't be flooded by one person and a change of heart
 * stays visible. Only people who really bought from the store can review it. A
 * reviewer may hide their name from the public and the owner; admins always see it.
 * What the public and the owner see is decided by the admins per store.
 *
 * Reports: anyone can report a store or a person (a store can report a customer);
 * an admin takes the report and settles it.
 */
/** Own copy (not imported) — commerce imports this module, so a shared constant could still be undefined here. */
const idParam = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid id');

export const feedbackRouter = Router();
feedbackRouter.use(requireAuth);

const REAL = `o.payment_status = 'completed' AND COALESCE(o.status,'') NOT IN ('cancelled','refunded')`;
const PUBLIC = ['off', 'stars', 'full'] as const;
const OWNER = ['none', 'anonymous', 'full'] as const;

async function mainStore(id: string) {
  const m = await one<any>(`SELECT id, parent_id, user_id, store_name, slug, review_public, review_owner, review_show FROM ${S}.merchants WHERE id = $1`, [id]);
  if (!m) throw notFound('Store not found', 'STORE_NOT_FOUND');
  return m.parent_id ? (await one<any>(`SELECT id, parent_id, user_id, store_name, slug, review_public, review_owner, review_show FROM ${S}.merchants WHERE id = $1`, [m.parent_id]))! : m;
}
const boughtFrom = (mainId: string, userId: string) =>
  one(`SELECT 1 FROM ${S}.orders o JOIN ${S}.merchants m ON m.id = o.merchant_id WHERE COALESCE(m.parent_id, m.id) = $1 AND o.user_id = $2 AND ${REAL} LIMIT 1`, [mainId, userId]);

/** Average, count and how many of each star — for a store. */
export async function reviewSummary(mainId: string) {
  const r = await one<any>(
    `SELECT (SELECT round(avg(stars)::numeric, 2)::float FROM ${S}.store_reviews WHERE merchant_id = $1 AND NOT hidden) AS avg,
            (SELECT count(*)::int FROM ${S}.store_reviews WHERE merchant_id = $1 AND NOT hidden) AS count,
            (SELECT COALESCE(json_object_agg(stars, n), '{}') FROM (SELECT stars, count(*)::int AS n FROM ${S}.store_reviews WHERE merchant_id = $1 AND NOT hidden GROUP BY stars) d) AS stars`,
    [mainId],
  );
  return { avg: r?.avg ?? null, count: r?.count ?? 0, stars: r?.stars ?? {} };
}

/** What a store page shows about its reviews, within what the admins allow and the owner chose. */
export async function publicReviews(mainId: string) {
  const m = await one<any>(`SELECT review_public, review_show FROM ${S}.merchants WHERE id = $1`, [mainId]);
  if (!m || m.review_public === 'off' || !m.review_show) return null;
  const sum = await reviewSummary(mainId);
  if (!sum.count) return null;
  const latest =
    m.review_public === 'full'
      ? (
          await pool.query(
            `SELECT r.stars, r.body, r.anonymous, r.updated_at, u.full_name FROM ${S}.store_reviews r JOIN ${S}.users u ON u.id = r.user_id
              WHERE r.merchant_id = $1 AND NOT r.hidden AND r.body IS NOT NULL ORDER BY r.updated_at DESC LIMIT 8`,
            [mainId],
          )
        ).rows.map((x) => ({ stars: x.stars, body: x.body, at: x.updated_at, name: x.anonymous ? null : maskName(x.full_name) }))
      : [];
  return { ...sum, level: m.review_public, latest };
}

// ------------------------------------------------------------------ reviews
feedbackRouter.get(
  '/stores/:id/my-review',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const main = await mainStore(req.params.id!);
    const me = req.auth!.userId;
    const r = await one<any>(`SELECT stars, body, anonymous, edits, created_at, updated_at FROM ${S}.store_reviews WHERE merchant_id = $1 AND user_id = $2`, [main.id, me]);
    res.json({ success: true, data: { review: r, canReview: String(main.user_id) !== String(me) && !!(await boughtFrom(main.id, me)) } });
  }),
);

feedbackRouter.put(
  '/stores/:id/my-review',
  validate({
    params: z.object({ id: idParam }).strict(),
    body: z.object({ stars: z.number().int().min(1).max(5), body: z.string().trim().max(1000).optional(), anonymous: z.boolean().default(false) }).strict(),
  }),
  ah(async (req, res) => {
    const main = await mainStore(req.params.id!);
    const me = req.auth!.userId;
    if (String(main.user_id) === String(me)) throw forbidden('You cannot review your own store', 'OWN_STORE');
    if (!(await boughtFrom(main.id, me))) throw forbidden('You can review a store after buying from it', 'NOT_A_CUSTOMER');
    const before = await one<any>(`SELECT id, stars, body, anonymous, updated_at FROM ${S}.store_reviews WHERE merchant_id = $1 AND user_id = $2`, [main.id, me]);
    if (before) {
      // Writing again changes your review; the earlier one is kept for the admins.
      await pool.query(`INSERT INTO ${S}.store_review_versions (review_id, stars, body, anonymous, created_at) VALUES ($1, $2, $3, $4, $5)`, [
        before.id,
        before.stars,
        before.body,
        before.anonymous,
        before.updated_at,
      ]);
      await pool.query(`UPDATE ${S}.store_reviews SET stars = $2, body = $3, anonymous = $4, edits = edits + 1, updated_at = now() WHERE id = $1`, [
        before.id,
        req.body.stars,
        req.body.body || null,
        req.body.anonymous,
      ]);
    } else {
      await pool.query(`INSERT INTO ${S}.store_reviews (merchant_id, user_id, stars, body, anonymous) VALUES ($1, $2, $3, $4, $5)`, [
        main.id,
        me,
        req.body.stars,
        req.body.body || null,
        req.body.anonymous,
      ]);
    }
    res.json({ success: true, data: { updated: !!before } });
  }),
);

/** The store owner's view — only as much as the admins allow (all, without names, or nothing). */
feedbackRouter.get(
  '/merchant/reviews',
  requireRole('merchant'),
  ah(async (req, res) => {
    const m = await myMerchant(req);
    const main = await mainStore(mainOf(m));
    const settings = { public: main.review_public, owner: main.review_owner, show: main.review_show };
    if (main.review_owner === 'none') return res.json({ success: true, data: { settings, summary: null, reviews: [] } });
    const r = await pool.query(
      `SELECT r.id, r.stars, r.body, r.anonymous, r.edits, r.updated_at, u.full_name FROM ${S}.store_reviews r JOIN ${S}.users u ON u.id = r.user_id
        WHERE r.merchant_id = $1 AND NOT r.hidden ORDER BY r.updated_at DESC LIMIT 200`,
      [main.id],
    );
    res.json({
      success: true,
      data: {
        settings,
        summary: await reviewSummary(main.id),
        reviews: r.rows.map((x) => ({ id: x.id, stars: x.stars, body: x.body, edited: x.edits > 0, at: x.updated_at, name: main.review_owner === 'full' && !x.anonymous ? x.full_name : null })),
      },
    });
  }),
);

/** The owner chooses to show reviews on the store page (if the admins allow it). */
feedbackRouter.put(
  '/merchant/reviews/show',
  requireRole('merchant'),
  validate({ body: z.object({ show: z.boolean() }).strict() }),
  ah(async (req, res) => {
    const main = await mainStore(mainOf(await myMerchant(req)));
    if (req.body.show && main.review_public === 'off') throw forbidden('Showing reviews isn’t open for your store yet', 'REVIEWS_CLOSED');
    await pool.query(`UPDATE ${S}.merchants SET review_show = $2 WHERE id = $1`, [main.id, req.body.show]);
    res.json({ success: true });
  }),
);

// ------------------------------------------------------------------ reports
export const REPORT_REASONS = ['fraud', 'not_delivered', 'bad_quality', 'abuse', 'fake', 'spam', 'payment', 'other'] as const;

feedbackRouter.post(
  '/reports',
  validate({
    body: z
      .object({
        userId: idParam.optional(),
        storeId: idParam.optional(),
        reason: z.enum(REPORT_REASONS),
        details: z.string().trim().min(10, 'Tell us a little more (10 characters or more)').max(2000),
      })
      .strict()
      .refine((b) => b.userId || b.storeId, 'Who are you reporting?'),
  }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const store = req.body.storeId ? await mainStore(req.body.storeId) : null;
    const target = store ? String(store.user_id) : String(req.body.userId);
    if (target === String(me)) throw badRequest('SELF', 'You cannot report yourself');
    if (!(await one(`SELECT 1 FROM ${S}.users WHERE id = $1`, [target]))) throw notFound('User not found');
    const today = await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.reports WHERE reporter_id = $1 AND created_at > now() - interval '1 day'`, [me]);
    if ((today?.n ?? 0) >= 10) throw tooMany('Up to 10 reports a day', 'REPORT_LIMIT');
    const r = await one<any>(
      `INSERT INTO ${S}.reports (reporter_id, target_user_id, target_merchant_id, reason, details) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [me, target, store?.id ?? null, req.body.reason, req.body.details],
    );
    const admins = await pool.query(
      `SELECT id FROM ${S}.users WHERE role = 'admin' AND status = 'active' AND (admin_level = 'super_admin' OR 'reports.manage' = ANY(admin_permissions))`,
    );
    for (const a of admins.rows)
      await notifyBi(undefined, a.id, 'report_new', ['New report', store ? `About the store ${store.store_name}` : 'About a person'], ['بلاغ جديد', store ? `عن متجر ${store.store_name}` : 'عن شخص'], {
        link: '/app/admin/reports',
      });
    await audit({ userId: me, action: 'report.created', entityType: 'report', entityId: r.id, details: { reason: req.body.reason, store: store?.id ?? null } }, req);
    res.status(201).json({ success: true, data: { id: r.id } });
  }),
);

feedbackRouter.get(
  '/reports/mine',
  ah(async (req, res) => {
    const r = await pool.query(
      `SELECT rp.id, rp.reason, rp.status, rp.resolution, rp.created_at, rp.resolved_at, m.store_name, u.full_name AS target_name
         FROM ${S}.reports rp LEFT JOIN ${S}.merchants m ON m.id = rp.target_merchant_id LEFT JOIN ${S}.users u ON u.id = rp.target_user_id
        WHERE rp.reporter_id = $1 ORDER BY rp.created_at DESC LIMIT 50`,
      [req.auth!.userId],
    );
    res.json({ success: true, data: { reports: r.rows.map((x) => ({ ...x, target_name: x.store_name ?? maskName(x.target_name) })) } });
  }),
);

// -------------------------------------------------------------------- admin
const admin = Router();
admin.use(requirePerm('reports.manage'));
feedbackRouter.use('/admin', admin);

/** Stores ranked by what their customers say, with reports and disputes beside it. */
admin.get(
  '/stores',
  validate({ query: z.object({ sort: z.enum(['worst', 'best', 'most', 'reports']).default('worst'), q: z.string().trim().max(60).optional() }).strict() }),
  ah(async (req, res) => {
    const q = req.query as any;
    const order = { worst: 'avg ASC NULLS LAST, count DESC', best: 'avg DESC NULLS LAST, count DESC', most: 'count DESC', reports: 'reports_open DESC, reports DESC' }[q.sort as 'worst'];
    const r = await pool.query(
      `SELECT * FROM (
         SELECT m.id, m.slug, m.store_name, m.logo_url, m.city, m.review_public, m.review_owner, m.review_show, u.full_name AS owner_name,
                (SELECT round(avg(r.stars)::numeric, 2)::float FROM ${S}.store_reviews r WHERE r.merchant_id = m.id AND NOT r.hidden) AS avg,
                (SELECT count(*)::int FROM ${S}.store_reviews r WHERE r.merchant_id = m.id AND NOT r.hidden) AS count,
                (SELECT count(*)::int FROM ${S}.store_reviews r WHERE r.merchant_id = m.id AND NOT r.hidden AND r.stars <= 2) AS low,
                (SELECT count(*)::int FROM ${S}.reports rp WHERE rp.target_merchant_id = m.id) AS reports,
                (SELECT count(*)::int FROM ${S}.reports rp WHERE rp.target_merchant_id = m.id AND rp.status IN ('open', 'handling')) AS reports_open,
                (SELECT count(*)::int FROM ${S}.orders o JOIN ${S}.merchants b ON b.id = o.merchant_id WHERE COALESCE(b.parent_id, b.id) = m.id AND ${REAL}) AS orders,
                (SELECT count(*)::int FROM ${S}.orders o JOIN ${S}.merchants b ON b.id = o.merchant_id WHERE COALESCE(b.parent_id, b.id) = m.id AND o.dispute_status IS NOT NULL) AS disputes
           FROM ${S}.merchants m JOIN ${S}.users u ON u.id = m.user_id
          WHERE m.parent_id IS NULL AND COALESCE(m.status, 'active') <> 'closed' AND ($1::text IS NULL OR m.store_name ILIKE $1 OR u.full_name ILIKE $1)) s
        ORDER BY ${order}, store_name LIMIT 200`,
      [q.q ? `%${q.q}%` : null],
    );
    res.json({ success: true, data: { stores: r.rows } });
  }),
);

/** One store: every review with the real name, earlier versions of edited reviews, and its reports. */
admin.get(
  '/stores/:id',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const main = await mainStore(req.params.id!);
    const [reviews, reports] = await Promise.all([
      pool.query(
        `SELECT r.id, r.stars, r.body, r.anonymous, r.hidden, r.edits, r.created_at, r.updated_at, u.id AS user_id, u.full_name, u.email,
                (SELECT COALESCE(json_agg(json_build_object('stars', v.stars, 'body', v.body, 'at', v.created_at) ORDER BY v.created_at DESC), '[]')
                   FROM ${S}.store_review_versions v WHERE v.review_id = r.id) AS versions,
                (SELECT count(*)::int FROM ${S}.orders o JOIN ${S}.merchants b ON b.id = o.merchant_id WHERE COALESCE(b.parent_id, b.id) = r.merchant_id AND o.user_id = r.user_id AND ${REAL}) AS orders
           FROM ${S}.store_reviews r JOIN ${S}.users u ON u.id = r.user_id WHERE r.merchant_id = $1 ORDER BY r.updated_at DESC`,
        [main.id],
      ),
      pool.query(
        `SELECT rp.id, rp.reason, rp.details, rp.status, rp.created_at, u.full_name AS reporter FROM ${S}.reports rp LEFT JOIN ${S}.users u ON u.id = rp.reporter_id
          WHERE rp.target_merchant_id = $1 ORDER BY rp.created_at DESC LIMIT 50`,
        [main.id],
      ),
    ]);
    res.json({
      success: true,
      data: { store: { id: main.id, store_name: main.store_name, slug: main.slug, review_public: main.review_public, review_owner: main.review_owner, review_show: main.review_show }, summary: await reviewSummary(main.id), reviews: reviews.rows, reports: reports.rows },
    });
  }),
);

const settingsBody = z.object({ public: z.enum(PUBLIC).optional(), owner: z.enum(OWNER).optional() }).strict();

admin.patch(
  '/stores/:id/settings',
  validate({ params: z.object({ id: idParam }).strict(), body: settingsBody }),
  ah(async (req, res) => {
    const main = await mainStore(req.params.id!);
    await pool.query(
      `UPDATE ${S}.merchants SET review_public = COALESCE($2, review_public), review_owner = COALESCE($3, review_owner),
              review_show = CASE WHEN COALESCE($2, review_public) = 'off' THEN false ELSE review_show END WHERE id = $1`,
      [main.id, req.body.public ?? null, req.body.owner ?? null],
    );
    await audit({ userId: req.auth!.userId, action: 'admin.review_settings', entityType: 'merchant', entityId: main.id, details: req.body }, req);
    res.json({ success: true });
  }),
);

/** The same choice for every store at once. */
admin.post(
  '/settings-all',
  validate({ body: settingsBody }),
  ah(async (req, res) => {
    const r = await pool.query(
      `UPDATE ${S}.merchants SET review_public = COALESCE($1, review_public), review_owner = COALESCE($2, review_owner),
              review_show = CASE WHEN COALESCE($1, review_public) = 'off' THEN false ELSE review_show END WHERE parent_id IS NULL`,
      [req.body.public ?? null, req.body.owner ?? null],
    );
    await audit({ userId: req.auth!.userId, action: 'admin.review_settings_all', details: { ...req.body, stores: r.rowCount } }, req);
    res.json({ success: true, data: { stores: r.rowCount } });
  }),
);

admin.patch(
  '/reviews/:id',
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ hidden: z.boolean() }).strict() }),
  ah(async (req, res) => {
    const r = await pool.query(`UPDATE ${S}.store_reviews SET hidden = $2 WHERE id = $1`, [req.params.id, req.body.hidden]);
    if (!r.rowCount) throw notFound('Review not found');
    await audit({ userId: req.auth!.userId, action: req.body.hidden ? 'admin.review_hidden' : 'admin.review_shown', entityType: 'review', entityId: req.params.id }, req);
    res.json({ success: true });
  }),
);

admin.get(
  '/reports',
  validate({ query: z.object({ status: z.enum(['open', 'mine', 'closed', 'all']).default('open') }).strict() }),
  ah(async (req, res) => {
    const st = String(req.query.status);
    const r = await pool.query(
      `SELECT rp.*, ru.full_name AS reporter_name, ru.profile_image AS reporter_image, tu.full_name AS target_name, tu.profile_image AS target_image, tu.role AS target_role,
              m.store_name, m.slug, m.logo_url, h.full_name AS handler_name,
              (SELECT count(*)::int FROM ${S}.reports x WHERE x.target_user_id = rp.target_user_id) AS target_reports
         FROM ${S}.reports rp LEFT JOIN ${S}.users ru ON ru.id = rp.reporter_id JOIN ${S}.users tu ON tu.id = rp.target_user_id
         LEFT JOIN ${S}.merchants m ON m.id = rp.target_merchant_id LEFT JOIN ${S}.users h ON h.id = rp.assigned_to
        WHERE ($1 = 'all') OR ($1 = 'open' AND rp.status IN ('open', 'handling')) OR ($1 = 'mine' AND rp.assigned_to = $2 AND rp.status = 'handling')
              OR ($1 = 'closed' AND rp.status IN ('resolved', 'dismissed'))
        ORDER BY (rp.status = 'open') DESC, rp.created_at DESC LIMIT 200`,
      [st, req.auth!.userId],
    );
    res.json({ success: true, data: { reports: r.rows } });
  }),
);

admin.post(
  '/reports/:id/claim',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const r = await one(`UPDATE ${S}.reports SET status = 'handling', assigned_to = $2, claimed_at = now() WHERE id = $1 AND status = 'open' RETURNING id`, [req.params.id, req.auth!.userId]);
    if (!r) throw conflict('ALREADY_TAKEN', 'Someone else already took this report');
    res.json({ success: true });
  }),
);

admin.post(
  '/reports/:id/resolve',
  validate({
    params: z.object({ id: idParam }).strict(),
    body: z.object({ outcome: z.enum(['resolved', 'dismissed']), resolution: z.string().trim().min(3).max(1000) }).strict(),
  }),
  ah(async (req, res) => {
    const r = await one<any>(
      `UPDATE ${S}.reports SET status = $2, resolution = $3, resolved_at = now(), assigned_to = COALESCE(assigned_to, $4)
        WHERE id = $1 AND status IN ('open', 'handling') AND (assigned_to IS NULL OR assigned_to = $4) RETURNING reporter_id`,
      [req.params.id, req.body.outcome, req.body.resolution, req.auth!.userId],
    );
    if (!r) throw conflict('REPORT_CLOSED', 'This report is closed or someone else is handling it');
    if (r.reporter_id)
      await notifyBi(
        undefined,
        r.reporter_id,
        'report_closed',
        ['Your report was reviewed', req.body.resolution],
        [req.body.outcome === 'resolved' ? 'انحلّ بلاغك' : 'راجعنا بلاغك', req.body.resolution],
        { link: '/app/settings?tab=account' },
      );
    await audit({ userId: req.auth!.userId, action: `admin.report_${req.body.outcome}`, entityType: 'report', entityId: req.params.id, details: { resolution: req.body.resolution } }, req);
    res.json({ success: true });
  }),
);

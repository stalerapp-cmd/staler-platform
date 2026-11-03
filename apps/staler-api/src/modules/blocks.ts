import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { one, pool, S, tx } from '../lib/db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { validate } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { requirePerm } from '../lib/permissions.js';
import { requireAuth } from '../middleware/auth.js';
import { notifyBi } from './walletCore.js';

/**
 * Blocking. A block stops every dealing between two accounts, in both directions:
 * no money, no messages, no saving as a contact, no adding to groups, no finding
 * each other in search. People manage their own list in Settings; the team sees
 * every block and can add or lift any of them.
 */
const idParam = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid id');

/** SQL fragment: true when $a and $b are blocked either way. */
export const blockedSql = (a: string, b: string) =>
  `EXISTS (SELECT 1 FROM ${S}.user_blocks ub WHERE (ub.blocker_id = ${a} AND ub.blocked_id = ${b}) OR (ub.blocker_id = ${b} AND ub.blocked_id = ${a}))`;

export async function isBlocked(a: string, b: string, c?: pg.PoolClient) {
  if (!a || !b || String(a) === String(b)) return false;
  const q = `SELECT ${blockedSql('$1::uuid', '$2::uuid')} AS x`;
  const r = c ? (await c.query(q, [a, b])).rows[0] : await one<any>(q, [a, b]);
  return !!r?.x;
}

export async function assertNotBlocked(a: string, b: string, c?: pg.PoolClient) {
  if (await isBlocked(a, b, c)) throw forbidden('You can’t deal with this account', 'BLOCKED');
}

/** What a block ends: saved contacts and group places (with their scheduled payments) between the two. */
async function cutTies(c: pg.PoolClient, a: string, b: string) {
  await c.query(`DELETE FROM ${S}.contacts WHERE (owner_id = $1 AND contact_user_id = $2) OR (owner_id = $2 AND contact_user_id = $1)`, [a, b]);
  await c.query(`DELETE FROM ${S}.people_members WHERE (owner_id = $1 AND user_id = $2) OR (owner_id = $2 AND user_id = $1)`, [a, b]);
}

const personCols = `u.id, u.full_name, u.profile_image, u.role, (SELECT wallet_id FROM ${S}.wallets WHERE user_id = u.id ORDER BY created_at LIMIT 1) AS wallet_id`;

export const blocksRouter = Router();
blocksRouter.use(requireAuth);

blocksRouter.get(
  '/',
  ah(async (req, res) => {
    const r = await pool.query(
      `SELECT b.id AS block_id, b.created_at, b.by_admin IS NOT NULL AS by_team, ${personCols}
         FROM ${S}.user_blocks b JOIN ${S}.users u ON u.id = b.blocked_id
        WHERE b.blocker_id = $1 ORDER BY b.created_at DESC`,
      [req.auth!.userId],
    );
    res.json({ success: true, data: { blocks: r.rows } });
  }),
);

blocksRouter.post(
  '/',
  validate({ body: z.object({ userId: idParam.optional(), who: z.string().trim().min(3).max(254).optional() }).strict().refine((b) => b.userId || b.who, 'Who do you want to block?') }),
  ah(async (req, res) => {
    const me = String(req.auth!.userId);
    const u = await one<any>(
      `SELECT u.id, u.role FROM ${S}.users u LEFT JOIN ${S}.wallets w ON w.user_id = u.id
        WHERE u.status <> 'deleted' AND (u.id::text = $1 OR w.wallet_id = $2 OR lower(u.email) = lower($2)) LIMIT 1`,
      [req.body.userId ?? '', req.body.who ?? ''],
    );
    if (!u) throw notFound('User not found');
    if (String(u.id) === me) throw badRequest('SELF', 'That’s you');
    if (u.role === 'admin') throw badRequest('BLOCK_ADMIN', 'The S-Taler team can’t be blocked');
    await tx(async (c) => {
      await c.query(`INSERT INTO ${S}.user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [me, u.id]);
      await cutTies(c, me, String(u.id));
    });
    await audit({ userId: me, action: 'user.blocked', entityType: 'user', entityId: String(u.id) }, req);
    res.status(201).json({ success: true });
  }),
);

blocksRouter.delete(
  '/:userId',
  validate({ params: z.object({ userId: idParam }).strict() }),
  ah(async (req, res) => {
    const me = String(req.auth!.userId);
    const b = await one<any>(`SELECT id, by_admin FROM ${S}.user_blocks WHERE blocker_id = $1 AND blocked_id = $2`, [me, req.params.userId]);
    if (!b) throw notFound('Not found');
    if (b.by_admin) throw forbidden('The team put this block — ask support to lift it', 'BLOCK_BY_TEAM');
    await pool.query(`DELETE FROM ${S}.user_blocks WHERE id = $1`, [b.id]);
    await audit({ userId: me, action: 'user.unblocked', entityType: 'user', entityId: req.params.userId! }, req);
    res.json({ success: true });
  }),
);

// ------------------------------------------------------------------ admins
export const blocksAdminRouter = Router();
blocksAdminRouter.use(requirePerm('users.status'));

blocksAdminRouter.get(
  '/',
  validate({ query: z.object({ q: z.string().trim().max(80).optional(), by: z.enum(['all', 'team', 'people']).default('all') }).strict() }),
  ah(async (req, res) => {
    const { q, by } = req.query as any;
    const r = await pool.query(
      `SELECT b.id, b.created_at, b.note, b.by_admin IS NOT NULL AS by_team, ad.full_name AS admin_name,
              jsonb_build_object('id', a.id, 'full_name', a.full_name, 'profile_image', a.profile_image, 'role', a.role, 'email', a.email) AS blocker,
              jsonb_build_object('id', x.id, 'full_name', x.full_name, 'profile_image', x.profile_image, 'role', x.role, 'email', x.email) AS blocked
         FROM ${S}.user_blocks b JOIN ${S}.users a ON a.id = b.blocker_id JOIN ${S}.users x ON x.id = b.blocked_id LEFT JOIN ${S}.users ad ON ad.id = b.by_admin
        WHERE ($1::text IS NULL OR a.full_name ILIKE $1 OR x.full_name ILIKE $1 OR a.email ILIKE $1 OR x.email ILIKE $1)
          AND ($2 = 'all' OR ($2 = 'team') = (b.by_admin IS NOT NULL))
        ORDER BY b.created_at DESC LIMIT 300`,
      [q ? `%${q}%` : null, by],
    );
    const t = await one<any>(`SELECT count(*)::int AS all, count(*) FILTER (WHERE by_admin IS NOT NULL)::int AS team FROM ${S}.user_blocks`);
    res.json({ success: true, data: { blocks: r.rows, totals: t } });
  }),
);

/** Keep two accounts apart: `blockedId` can no longer deal with `blockerId` (and the other way round). */
blocksAdminRouter.post(
  '/',
  validate({ body: z.object({ blockerId: idParam, blockedId: idParam, note: z.string().trim().max(300).optional() }).strict() }),
  ah(async (req, res) => {
    const { blockerId, blockedId, note } = req.body;
    if (blockerId === blockedId) throw badRequest('SELF', 'Pick two different people');
    const n = await one<any>(`SELECT count(*)::int AS n FROM ${S}.users WHERE id = ANY($1) AND status <> 'deleted'`, [[blockerId, blockedId]]);
    if (n?.n !== 2) throw notFound('User not found');
    await tx(async (c) => {
      await c.query(
        `INSERT INTO ${S}.user_blocks (blocker_id, blocked_id, by_admin, note) VALUES ($1, $2, $3, $4)
         ON CONFLICT (blocker_id, blocked_id) DO UPDATE SET by_admin = EXCLUDED.by_admin, note = EXCLUDED.note`,
        [blockerId, blockedId, req.auth!.userId, note ?? null],
      );
      await cutTies(c, blockerId, blockedId);
    });
    await audit({ userId: req.auth!.userId, action: 'admin.block_added', entityType: 'user', entityId: blockedId, details: { blockerId, note } }, req);
    res.status(201).json({ success: true });
  }),
);

blocksAdminRouter.delete(
  '/:id',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const b = await one<any>(`DELETE FROM ${S}.user_blocks WHERE id = $1 RETURNING blocker_id, blocked_id, by_admin`, [req.params.id]);
    if (!b) throw notFound('Not found');
    if (!b.by_admin)
      await notifyBi(undefined, b.blocker_id, 'block_lifted', ['A block was lifted by the team', 'Someone you blocked was unblocked by S-Taler support.'], ['الإدارة شالت بلوك', 'الدعم شال بلوك كنت عامله لحدا. بتقدر ترجع تبلكه من الإعدادات.'], {
        link: '/app/settings?tab=privacy',
      });
    await audit({ userId: req.auth!.userId, action: 'admin.block_removed', entityType: 'user', entityId: String(b.blocked_id), details: { blockerId: b.blocker_id } }, req);
    res.json({ success: true });
  }),
);

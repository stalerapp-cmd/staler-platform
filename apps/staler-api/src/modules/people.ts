import { Router } from 'express';
import { z } from 'zod';
import { one, pool, S, tx } from '../lib/db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { amountSchema, fromCents, toCents } from '../lib/money.js';
import { totpCode, validate } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { requirePerm } from '../lib/permissions.js';
import { requireAuth } from '../middleware/auth.js';
import { moneyLimiter } from '../middleware/security.js';
import { requireSecondFactor } from './mfa.js';
import { resolveRecipient } from './wallet.js';
import { hasBankLink, pullFromBank, pushToBank } from './bank.js';
import { assertDailyLimit, assertMaxTransfer, maskName, notifyBi, walletOfUser, walletToWallet } from './walletCore.js';

/**
 * Your people, in groups you name (children, staff, relatives…), with recurring
 * transfers to them: from your wallet or your bank, to their wallet or their bank.
 * You can pause or stop any time; admins with "people.oversee" can see and pause too.
 *
 * Someone in a group can be asked to show it on their profile ("works at …"); it
 * shows only if they accept, and they can hide it again.
 */
export const peopleRouter = Router();
peopleRouter.use(requireAuth);

const idParam = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid id');
const KINDS = ['family', 'staff', 'relatives', 'custom', 'debt', 'partners', 'suppliers', 'bills'] as const;
const EVERY = ['once', 'week', '2weeks', 'month', 'days'] as const;
/** SQL interval for one period; `p` is the payouts row alias (for "every N days"). */
const intervalOf = (e: string, p = 'payouts') =>
  e === 'week' ? `interval '7 days'` : e === '2weeks' ? `interval '14 days'` : e === 'days' ? `make_interval(days => COALESCE(${p}.every_days, 1))` : `interval '1 month'`;

const MEMBER_COLS = `m.id, m.group_id, m.user_id, m.nickname, m.role_title, m.since, m.favourite, m.sort, m.link_status, m.show_on_profile, m.created_at,
  u.full_name, u.profile_image, w.wallet_id,
  (SELECT COALESCE(json_agg(json_build_object('id', p.id, 'amount', p.amount, 'source', p.source, 'dest', p.dest, 'every', p.every, 'next_run_at', p.next_run_at,
     'active', p.active, 'paused_by_admin', p.paused_by_admin, 'admin_note', p.admin_note, 'note', p.note, 'runs', p.runs, 'total', p.total, 'last_run_at', p.last_run_at, 'fail_count', p.fail_count)
     ORDER BY p.created_at), '[]') FROM ${S}.payouts p WHERE p.member_id = m.id) AS payouts,
  (SELECT COALESCE(sum(r.amount), 0)::text FROM ${S}.payout_runs r WHERE r.member_id = m.id AND r.status = 'done') AS paid_total`;
const memberFrom = `FROM ${S}.people_members m JOIN ${S}.users u ON u.id = m.user_id
  LEFT JOIN LATERAL (SELECT wallet_id FROM ${S}.wallets WHERE user_id = u.id ORDER BY created_at ASC NULLS LAST LIMIT 1) w ON true`;

async function ownGroup(id: string, owner: string) {
  const g = await one<any>(`SELECT * FROM ${S}.people_groups WHERE id = $1 AND owner_id = $2`, [id, owner]);
  if (!g) throw notFound('Group not found');
  return g;
}
async function ownMember(id: string, owner: string) {
  const m = await one<any>(`SELECT m.*, g.workplace, g.name AS group_name, g.kind FROM ${S}.people_members m JOIN ${S}.people_groups g ON g.id = m.group_id WHERE m.id = $1 AND m.owner_id = $2`, [id, owner]);
  if (!m) throw notFound('Person not found');
  return m;
}

/** Everything for the owner: groups, people in them, their transfers. */
export async function groupsOf(owner: string) {
  const groups = await pool.query(`SELECT * FROM ${S}.people_groups WHERE owner_id = $1 ORDER BY sort, created_at`, [owner]);
  const members = await pool.query(`SELECT ${MEMBER_COLS} ${memberFrom} WHERE m.owner_id = $1 ORDER BY m.favourite DESC, m.sort, m.created_at`, [owner]);
  return groups.rows.map((g) => ({ ...g, members: members.rows.filter((m) => String(m.group_id) === String(g.id)) }));
}

peopleRouter.get(
  '/groups',
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const groups = await groupsOf(me);
    const t = await one<any>(
      `SELECT COALESCE(sum(amount) FILTER (WHERE status = 'done' AND ran_at > now() - interval '30 days'), 0)::text AS last30,
              (SELECT COALESCE(sum(CASE every WHEN 'week' THEN amount * 4.33 WHEN '2weeks' THEN amount * 2.17 ELSE amount END), 0)::numeric(20,2)::text
                 FROM ${S}.payouts WHERE owner_id = $1 AND active AND NOT paused_by_admin) AS monthly
         FROM ${S}.payout_runs WHERE owner_id = $1`,
      [me],
    );
    res.json({ success: true, data: { groups, totals: t, bankLinked: await hasBankLink(me) } });
  }),
);

const groupBody = z
  .object({
    name: z.string().trim().min(1).max(40),
    kind: z.enum(KINDS).default('custom'),
    icon: z.string().trim().max(24).nullable().optional(),
    workplace: z.string().trim().max(80).nullable().optional(),
    seniorAfterMonths: z.number().int().min(1).max(600).nullable().optional(),
    /** A work group: workplace on members' profiles, seniority, bonuses. */
    isWork: z.boolean().optional(),
  })
  .strict();

peopleRouter.post(
  '/groups',
  validate({ body: groupBody }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.people_groups WHERE owner_id = $1`, [me]);
    if ((n?.n ?? 0) >= 20) throw badRequest('TOO_MANY_GROUPS', 'Up to 20 groups');
    const b = req.body;
    const g = await one(
      `INSERT INTO ${S}.people_groups (owner_id, name, kind, icon, workplace, senior_after_months, sort, is_work) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [me, b.name, b.kind, b.icon ?? null, b.workplace ?? null, b.seniorAfterMonths ?? null, n?.n ?? 0, b.isWork ?? b.kind === 'staff'],
    );
    res.status(201).json({ success: true, data: { group: g } });
  }),
);

peopleRouter.put(
  '/groups/:id',
  validate({ params: z.object({ id: idParam }).strict(), body: groupBody }),
  ah(async (req, res) => {
    await ownGroup(req.params.id!, req.auth!.userId);
    const b = req.body;
    await pool.query(`UPDATE ${S}.people_groups SET name = $2, kind = $3, icon = $4, workplace = $5, senior_after_months = $6, is_work = COALESCE($7, is_work) WHERE id = $1`, [
      req.params.id,
      b.name,
      b.kind,
      b.icon ?? null,
      b.workplace ?? null,
      b.seniorAfterMonths ?? null,
      b.isWork ?? null,
    ]);
    res.json({ success: true });
  }),
);

peopleRouter.delete(
  '/groups/:id',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    await ownGroup(req.params.id!, req.auth!.userId);
    await pool.query(`DELETE FROM ${S}.people_groups WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  }),
);

peopleRouter.post(
  '/groups/:id/members',
  validate({
    params: z.object({ id: idParam }).strict(),
    body: z
      .object({
        who: z.string().trim().min(3).max(254),
        nickname: z.string().trim().max(60).optional(),
        roleTitle: z.string().trim().max(60).optional(),
        since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        invite: z.boolean().default(false),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const g = await ownGroup(req.params.id!, me);
    const r = await resolveRecipient(req.body.who);
    if (!r) throw notFound('No wallet found for that ID or e-mail', 'RECIPIENT_NOT_FOUND');
    if (String(r.user_id) === String(me)) throw badRequest('SELF', 'You cannot add yourself');
    const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.people_members WHERE group_id = $1`, [g.id]);
    if ((n?.n ?? 0) >= 200) throw badRequest('GROUP_FULL', 'Up to 200 people in a group');
    const m = await one<any>(
      `INSERT INTO ${S}.people_members (group_id, owner_id, user_id, nickname, role_title, since, link_status, sort)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (group_id, user_id) DO NOTHING RETURNING id`,
      [g.id, me, r.user_id, req.body.nickname || null, req.body.roleTitle || null, req.body.since ?? null, req.body.invite ? 'invited' : 'none', n?.n ?? 0],
    );
    if (!m) throw badRequest('ALREADY_IN_GROUP', 'This person is already in the group');
    if (req.body.invite) await inviteNotice(me, r.user_id, g.workplace || g.name);
    res.status(201).json({ success: true, data: { id: m.id, name: maskName(r.full_name) } });
  }),
);

async function inviteNotice(owner: string, user: string, place: string) {
  const o = await one<any>(`SELECT full_name FROM ${S}.users WHERE id = $1`, [owner]);
  await notifyBi(
    undefined,
    user,
    'workplace_invite',
    [`${o?.full_name ?? ''} added you to “${place}”`, 'Accept to show it on your profile — or decline. You can hide it later.'],
    [`${o?.full_name ?? ''} ضافك لـ «${place}»`, 'إذا وافقت بيبين بملفك إنك هناك — أو ارفض. وبتقدر تخفيه بعدين.'],
    { link: '/app/settings?tab=account#workplaces' },
  );
}

peopleRouter.put(
  '/members/:id',
  validate({
    params: z.object({ id: idParam }).strict(),
    body: z
      .object({
        nickname: z.string().trim().max(60).nullable().optional(),
        roleTitle: z.string().trim().max(60).nullable().optional(),
        since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        favourite: z.boolean().optional(),
        groupId: idParam.optional(),
        invite: z.boolean().optional(),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const m = await ownMember(req.params.id!, me);
    const b = req.body;
    if (b.groupId) await ownGroup(b.groupId, me);
    await pool.query(
      `UPDATE ${S}.people_members SET
         nickname = CASE WHEN $3 THEN $2 ELSE nickname END,
         role_title = CASE WHEN $5 THEN $4 ELSE role_title END,
         since = CASE WHEN $7 THEN $6::date ELSE since END,
         favourite = COALESCE($8, favourite),
         group_id = COALESCE($9, group_id),
         link_status = CASE WHEN $10 AND link_status IN ('none', 'declined') THEN 'invited' WHEN $11 THEN 'none' ELSE link_status END
       WHERE id = $1`,
      [m.id, b.nickname ?? null, b.nickname !== undefined, b.roleTitle ?? null, b.roleTitle !== undefined, b.since ?? null, b.since !== undefined, b.favourite ?? null, b.groupId ?? null, b.invite === true, b.invite === false],
    );
    if (b.invite === true && ['none', 'declined'].includes(m.link_status)) await inviteNotice(me, m.user_id, m.workplace || m.group_name);
    res.json({ success: true });
  }),
);

peopleRouter.put(
  '/members-order',
  validate({ body: z.object({ ids: z.array(idParam).max(400) }).strict() }),
  ah(async (req, res) => {
    for (const [i, id] of req.body.ids.entries()) await pool.query(`UPDATE ${S}.people_members SET sort = $3 WHERE id = $1 AND owner_id = $2`, [id, req.auth!.userId, i]);
    res.json({ success: true });
  }),
);

peopleRouter.delete(
  '/members/:id',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const m = await ownMember(req.params.id!, req.auth!.userId);
    await pool.query(`DELETE FROM ${S}.people_members WHERE id = $1`, [m.id]);
    res.json({ success: true });
  }),
);

// -------------------------------------------------------------- transfers
const payoutBody = z
  .object({
    amount: amountSchema,
    source: z.enum(['wallet', 'bank']).default('wallet'),
    dest: z.enum(['wallet', 'bank']).default('wallet'),
    every: z.enum(EVERY),
    /** First transfer (defaults to now). */
    startAt: z.string().datetime().optional(),
    note: z.string().trim().max(120).optional(),
    totp: totpCode.optional(),
  })
  .strict();

peopleRouter.post(
  '/members/:id/payouts',
  moneyLimiter,
  validate({ params: z.object({ id: idParam }).strict(), body: payoutBody }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const m = await ownMember(req.params.id!, me);
    const b = req.body;
    assertMaxTransfer(b.amount);
    // Money will leave on its own from now on: people with 2-step verification confirm with their code.
    await requireSecondFactor(me, b.totp);
    if (b.source === 'bank' && !(await hasBankLink(me))) throw badRequest('BANK_NOT_LINKED', 'Link your TalerBank account first');
    const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.payouts WHERE owner_id = $1 AND active`, [me]);
    if ((n?.n ?? 0) >= 100) throw badRequest('TOO_MANY_PAYOUTS', 'Up to 100 recurring transfers');
    const start = b.startAt ? new Date(b.startAt) : new Date();
    const p = await one(
      `INSERT INTO ${S}.payouts (owner_id, member_id, amount, source, dest, every, next_run_at, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [me, m.id, b.amount, b.source, b.dest, b.every, start, b.note || null],
    );
    await audit({ userId: me, action: 'people.payout_created', entityType: 'payout', entityId: (p as any).id, details: { amount: b.amount, every: b.every, source: b.source, dest: b.dest, to: m.user_id } }, req);
    // A start date in the past or now runs straight away.
    if (start.getTime() <= Date.now() + 60_000) await runPayouts([(p as any).id]);
    res.status(201).json({ success: true, data: { id: (p as any).id } });
  }),
);

peopleRouter.put(
  '/payouts/:id',
  validate({
    params: z.object({ id: idParam }).strict(),
    body: z
      .object({
        amount: amountSchema.optional(),
        every: z.enum(EVERY).optional(),
        source: z.enum(['wallet', 'bank']).optional(),
        dest: z.enum(['wallet', 'bank']).optional(),
        active: z.boolean().optional(),
        note: z.string().trim().max(120).nullable().optional(),
        totp: totpCode.optional(),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const p = await one<any>(`SELECT * FROM ${S}.payouts WHERE id = $1 AND owner_id = $2`, [req.params.id, me]);
    if (!p) throw notFound('Transfer not found');
    const b = req.body;
    // Raising the amount or turning it back on moves money: confirm like a new one.
    if ((b.amount && toCents(b.amount) > toCents(p.amount)) || (b.active && !p.active)) await requireSecondFactor(me, b.totp);
    if (b.amount) assertMaxTransfer(b.amount);
    if (b.source === 'bank' && !(await hasBankLink(me))) throw badRequest('BANK_NOT_LINKED', 'Link your TalerBank account first');
    await pool.query(
      `UPDATE ${S}.payouts SET amount = COALESCE($2, amount), every = COALESCE($3, every), source = COALESCE($4, source), dest = COALESCE($5, dest),
              active = COALESCE($6, active), note = CASE WHEN $8 THEN $7 ELSE note END,
              next_run_at = CASE WHEN $6 AND NOT active AND next_run_at < now() THEN now() + interval '1 hour' ELSE next_run_at END
        WHERE id = $1`,
      [p.id, b.amount ?? null, b.every ?? null, b.source ?? null, b.dest ?? null, b.active ?? null, b.note ?? null, b.note !== undefined],
    );
    await audit({ userId: me, action: 'people.payout_changed', entityType: 'payout', entityId: p.id, details: { ...b, totp: undefined } }, req);
    res.json({ success: true });
  }),
);

peopleRouter.delete(
  '/payouts/:id',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const r = await pool.query(`DELETE FROM ${S}.payouts WHERE id = $1 AND owner_id = $2`, [req.params.id, req.auth!.userId]);
    if (!r.rowCount) throw notFound('Transfer not found');
    await audit({ userId: req.auth!.userId, action: 'people.payout_stopped', entityType: 'payout', entityId: req.params.id }, req);
    res.json({ success: true });
  }),
);

/** A one-off extra (a bonus, a gift) to someone in your groups, now. */
peopleRouter.post(
  '/members/:id/bonus',
  moneyLimiter,
  validate({
    params: z.object({ id: idParam }).strict(),
    body: z.object({ amount: amountSchema, source: z.enum(['wallet', 'bank']).default('wallet'), note: z.string().trim().max(120).optional(), totp: totpCode.optional() }).strict(),
  }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const m = await ownMember(req.params.id!, me);
    await requireSecondFactor(me, req.body.totp);
    const r = await deliver({ ownerId: me, memberId: m.id, memberUserId: m.user_id, amount: req.body.amount, source: req.body.source, dest: 'wallet', kind: 'bonus', note: req.body.note ?? null });
    if (r.status === 'failed') throw badRequest(r.code ?? 'TRANSFER_FAILED', r.error ?? 'The transfer failed');
    res.json({ success: true, data: r });
  }),
);

peopleRouter.get(
  '/runs',
  validate({ query: z.object({ member: idParam.optional() }).strict() }),
  ah(async (req, res) => {
    const r = await pool.query(
      `SELECT r.id, r.amount, r.kind, r.status, r.error, r.note, r.ran_at, r.member_id, u.full_name
         FROM ${S}.payout_runs r LEFT JOIN ${S}.users u ON u.id = r.member_user_id
        WHERE r.owner_id = $1 AND ($2::uuid IS NULL OR r.member_id = $2) ORDER BY r.ran_at DESC LIMIT 100`,
      [req.auth!.userId, (req.query as any).member ?? null],
    );
    res.json({ success: true, data: { runs: r.rows } });
  }),
);

// ------------------------------------------------------------ member side
/** Places that added me, and whether they show on my profile. */
peopleRouter.get(
  '/workplaces',
  ah(async (req, res) => {
    const r = await pool.query(
      `SELECT m.id, m.link_status, m.show_on_profile, m.since, m.role_title, g.name AS group_name, g.workplace, g.kind, o.full_name AS owner_name, o.profile_image AS owner_image,
              (SELECT store_name FROM ${S}.merchants WHERE user_id = o.id AND parent_id IS NULL ORDER BY created_at LIMIT 1) AS store_name
         FROM ${S}.people_members m JOIN ${S}.people_groups g ON g.id = m.group_id JOIN ${S}.users o ON o.id = m.owner_id
        WHERE m.user_id = $1 AND m.link_status IN ('invited', 'accepted', 'declined') ORDER BY m.created_at DESC`,
      [req.auth!.userId],
    );
    res.json({ success: true, data: { workplaces: r.rows } });
  }),
);

peopleRouter.post(
  '/workplaces/:id',
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ accept: z.boolean().optional(), show: z.boolean().optional() }).strict() }),
  ah(async (req, res) => {
    const r = await one<any>(
      `UPDATE ${S}.people_members SET link_status = CASE WHEN $3::boolean IS NULL THEN link_status WHEN $3 THEN 'accepted' ELSE 'declined' END,
              show_on_profile = COALESCE($4, show_on_profile)
        WHERE id = $1 AND user_id = $2 AND link_status <> 'none' RETURNING owner_id, link_status`,
      [req.params.id, req.auth!.userId, req.body.accept ?? null, req.body.show ?? null],
    );
    if (!r) throw notFound('Not found');
    res.json({ success: true, data: { status: r.link_status } });
  }),
);

/** For a person's public card: where they work, as they agreed to show. */
export async function workplacesOf(userId: string) {
  const r = await pool.query(
    `SELECT COALESCE(g.workplace, (SELECT store_name FROM ${S}.merchants WHERE user_id = m.owner_id AND parent_id IS NULL ORDER BY created_at LIMIT 1), o.full_name) AS place,
            m.role_title, m.since
       FROM ${S}.people_members m JOIN ${S}.people_groups g ON g.id = m.group_id JOIN ${S}.users o ON o.id = m.owner_id
      WHERE m.user_id = $1 AND m.link_status = 'accepted' AND m.show_on_profile`,
    [userId],
  );
  return r.rows;
}

// --------------------------------------------------------------- the runs
type Delivery = { ownerId: string; memberId: string; memberUserId: string; amount: string; source: 'wallet' | 'bank'; dest: 'wallet' | 'bank'; kind: 'scheduled' | 'bonus'; note: string | null; payoutId?: string; pendingOp?: string | null };

/**
 * Moves one transfer: (bank → owner's wallet), owner's wallet → member's wallet, (→ member's bank).
 * A bank that doesn't answer in time leaves the run "waiting": it finishes on a later pass.
 */
async function deliver(d: Delivery): Promise<{ status: 'done' | 'failed' | 'waiting'; error?: string; code?: string; pendingOp?: string | null }> {
  const record = (status: string, error?: string) =>
    pool.query(
      `INSERT INTO ${S}.payout_runs (payout_id, owner_id, member_user_id, member_id, amount, kind, status, error, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [d.payoutId ?? null, d.ownerId, d.memberUserId, d.memberId, d.amount, d.kind, status, error ?? null, d.note],
    );
  try {
    if (d.source === 'bank') {
      if (d.pendingOp) {
        const op = await one<any>(`SELECT status FROM ${S}.bank_operations WHERE id = $1`, [d.pendingOp]);
        if (op?.status === 'pending') return { status: 'waiting', pendingOp: d.pendingOp };
        if (op?.status !== 'completed') throw Object.assign(new Error('The bank did not send the money'), { code: 'BANK_FAILED' });
      } else {
        const pulled = await pullFromBank(d.ownerId, d.amount);
        if (pulled.status === 'processing') {
          await record('waiting', 'Waiting for the bank');
          return { status: 'waiting', pendingOp: pulled.operationId };
        }
      }
    }
    const names = await pool.query(`SELECT id, full_name FROM ${S}.users WHERE id = ANY($1::uuid[])`, [[d.ownerId, d.memberUserId]]);
    const nameOf = (x: string) => names.rows.find((r) => String(r.id) === String(x))?.full_name ?? null;
    await tx(async (c) => {
      const from = await walletOfUser(d.ownerId, c);
      const to = await walletOfUser(d.memberUserId, c);
      await assertDailyLimit(c, from.wallet_id, d.amount);
      await walletToWallet(c, {
        fromWalletDbId: from.id,
        toWalletDbId: to.id,
        amount: d.amount,
        outType: 'transfer_out',
        inType: 'transfer_in',
        description: d.note || (d.kind === 'bonus' ? 'Bonus' : 'Scheduled transfer'),
        fromName: nameOf(d.ownerId),
        toName: nameOf(d.memberUserId),
        metadata: { payout: d.payoutId ?? null, kind: d.kind },
      });
    });
    let toBank = false;
    if (d.dest === 'bank' && (await hasBankLink(d.memberUserId))) {
      try {
        await pushToBank(d.memberUserId, d.amount);
        toBank = true;
      } catch (e) {
        logger.warn({ err: e }, 'payout: could not forward to the member’s bank; it stays in their wallet');
      }
    }
    await record('done');
    const from = nameOf(d.ownerId) ?? '';
    await notifyBi(
      undefined,
      d.memberUserId,
      'money_received',
      [`${from} sent you ${d.amount}`, d.note ?? (d.kind === 'bonus' ? 'A bonus' : 'Your regular transfer')],
      [`${from} بعتلك ${d.amount}`, `${d.note ?? (d.kind === 'bonus' ? 'مكافأة' : 'تحويلك الدوري')}${toBank ? ' — راحت لبنكك' : ''}`],
      { link: '/app/activity' },
    );
    return { status: 'done' };
  } catch (e: any) {
    const msg = e?.message ?? 'Transfer failed';
    await record('failed', msg);
    return { status: 'failed', error: msg, code: e?.code };
  }
}

/** After a payment (done or skipped): the next date, or the end of the schedule. */
async function advance(p: any, counted: boolean) {
  const runs = p.runs + (counted ? 1 : 0);
  const r = await one<any>(
    `UPDATE ${S}.payouts SET pending_op = NULL, fail_count = 0, awaiting = false, runs = $2,
            total = total + CASE WHEN $3 THEN amount ELSE 0 END, last_run_at = CASE WHEN $3 THEN now() ELSE last_run_at END,
            next_run_at = GREATEST(next_run_at, now() - interval '1 day') + ${intervalOf(p.every)}
      WHERE id = $1 RETURNING *`,
    [p.id, runs, counted],
  );
  const over =
    r.every === 'once' || (r.ends === 'count' && r.max_runs != null && runs >= r.max_runs) || (r.ends === 'until' && r.end_date && new Date(r.next_run_at) > new Date(`${String(r.end_date).slice(0, 10)}T23:59:59Z`));
  if (over) {
    await pool.query(`UPDATE ${S}.payouts SET active = false, finished_at = now() WHERE id = $1`, [p.id]);
    if (r.every !== 'once')
      await notifyBi(undefined, p.owner_id, 'payout_finished', ['A scheduled payment is complete', `${r.title ?? ''} — ${runs} payments`], ['خلصت دفعة مجدولة', `${r.title ?? ''} — ${runs} دفعة`], { link: '/app/people' });
  }
}

/** Runs the payments that are due (all, or only the given ones), and sends reminders. Called every couple of minutes. */
export async function runPayouts(only?: string[]) {
  await remind();
  const due = await pool.query(
    `SELECT p.*, m.user_id AS member_user_id, u.full_name AS member_name FROM ${S}.payouts p JOIN ${S}.people_members m ON m.id = p.member_id JOIN ${S}.users u ON u.id = m.user_id
      WHERE p.active AND NOT p.paused_by_admin AND NOT p.awaiting AND p.next_run_at <= now() + interval '1 minute' AND ($1::uuid[] IS NULL OR p.id = ANY($1))
      ORDER BY p.next_run_at LIMIT 50`,
    [only ?? null],
  );
  let done = 0;
  for (const p of due.rows) {
    // Remind-only payments wait for the owner to pay.
    if (!p.auto && !only) {
      await pool.query(`UPDATE ${S}.payouts SET awaiting = true WHERE id = $1`, [p.id]);
      await notifyBi(
        undefined,
        p.owner_id,
        'payout_due',
        ['A scheduled payment is due', `${p.amount} to ${p.member_name}${p.title ? ` — ${p.title}` : ''}. Pay it with one tap.`],
        ['حان موعد دفعة', `${p.amount} لـ ${p.member_name}${p.title ? ` — ${p.title}` : ''}. ادفعها بكبسة.`],
        { link: '/app/people' },
      );
      continue;
    }
    // Claim it first so two servers never pay the same payment twice.
    const claimed = await one(`UPDATE ${S}.payouts SET next_run_at = next_run_at + interval '1 second' WHERE id = $1 AND next_run_at = $2 AND NOT awaiting RETURNING *`, [p.id, p.next_run_at]);
    if (!claimed) continue;
    const r = await deliver({
      ownerId: p.owner_id,
      memberId: p.member_id,
      memberUserId: p.member_user_id,
      amount: fromCents(toCents(p.amount)),
      source: p.source,
      dest: p.dest,
      kind: 'scheduled',
      note: p.title ?? p.note,
      payoutId: p.id,
      pendingOp: p.pending_op,
    });
    if (r.status === 'waiting') {
      await pool.query(`UPDATE ${S}.payouts SET pending_op = $2, next_run_at = now() + interval '5 minutes' WHERE id = $1`, [p.id, r.pendingOp ?? null]);
    } else if (r.status === 'done') {
      done++;
      await advance(claimed, true);
    } else {
      // Try again tomorrow; after three misses, move to the next date and tell the owner.
      const fails = p.fail_count + 1;
      if (fails >= 3) await advance(claimed, false);
      else await pool.query(`UPDATE ${S}.payouts SET pending_op = NULL, fail_count = $2, next_run_at = now() + interval '1 day' WHERE id = $1`, [p.id, fails]);
      await notifyBi(
        undefined,
        p.owner_id,
        'payout_failed',
        ['A scheduled payment didn’t go through', `${p.amount} to ${p.member_name} — ${r.error ?? ''}`],
        ['ما زبطت دفعة مجدولة', `${p.amount} لـ ${p.member_name} — ${r.error ?? ''}. ${fails >= 3 ? 'انتقلت للموعد الجاي.' : 'رح نجرّب بكرا.'}`],
        { link: '/app/people' },
      );
    }
  }
  return { done, due: due.rowCount ?? 0 };
}

/** "Tomorrow 50 goes to Ahmad" — the reminder the owner chose, once per payment date. */
async function remind() {
  const r = await pool.query(
    `SELECT p.id, p.owner_id, p.amount, p.title, p.next_run_at, p.remind_before, p.auto, u.full_name AS member_name
       FROM ${S}.payouts p JOIN ${S}.people_members m ON m.id = p.member_id JOIN ${S}.users u ON u.id = m.user_id
      WHERE p.active AND NOT p.paused_by_admin AND p.remind_before IS NOT NULL AND p.reminded_for IS DISTINCT FROM p.next_run_at
        AND now() >= p.next_run_at - make_interval(days => p.remind_before) - CASE WHEN p.remind_before = 0 THEN interval '3 hours' ELSE interval '0' END
        AND p.next_run_at > now() LIMIT 100`,
  );
  for (const p of r.rows) {
    await pool.query(`UPDATE ${S}.payouts SET reminded_for = next_run_at WHERE id = $1`, [p.id]);
    const when = p.remind_before === 0 ? ['today', 'اليوم'] : p.remind_before === 1 ? ['tomorrow', 'بكرا'] : [`in ${p.remind_before} days`, `بعد ${p.remind_before} أيام`];
    await notifyBi(
      undefined,
      p.owner_id,
      'payout_reminder',
      [`Reminder: ${p.amount} to ${p.member_name} ${when[0]}`, p.auto ? 'It goes out by itself — pause it if you need to.' : 'Pay it when it’s due.'],
      [`تذكير: ${p.amount} لـ ${p.member_name} ${when[1]}`, `${p.title ? `${p.title}. ` : ''}${p.auto ? 'رح تنبعت لحالها — وقّفها إذا بدك.' : 'ادفعها لما يجي موعدها.'}`],
      { link: '/app/people' },
    );
  }
}

// --------------------------------------------------------- the simple flow
const scheduleBody = z
  .object({
    /** Who: a user id (from contacts or search), or a wallet ID / e-mail. */
    userId: idParam.optional(),
    who: z.string().trim().min(3).max(254).optional(),
    groupId: idParam.nullable().optional(),
    title: z.string().trim().max(60).optional(),
    amount: amountSchema,
    every: z.enum(EVERY),
    everyDays: z.number().int().min(1).max(365).optional(),
    startAt: z.string().datetime().optional(),
    ends: z.enum(['never', 'until', 'count']).default('never'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    maxRuns: z.number().int().min(1).max(1000).optional(),
    source: z.enum(['wallet', 'bank']).default('wallet'),
    dest: z.enum(['wallet', 'bank']).default('wallet'),
    auto: z.boolean().default(true),
    remindBefore: z.number().int().min(0).max(30).nullable().optional(),
    totp: totpCode.optional(),
  })
  .strict()
  .refine((b) => b.userId || b.who, 'Choose who to pay')
  .refine((b) => b.every !== 'days' || b.everyDays, 'How many days between payments?')
  .refine((b) => b.ends !== 'until' || b.endDate, 'Choose the last date')
  .refine((b) => b.ends !== 'count' || b.maxRuns, 'How many payments?');

/** Everything on the page: categories, schedules (with the person), people, totals and the next payment. */
peopleRouter.get(
  '/overview',
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const groups = await pool.query(
      `SELECT g.*, (SELECT count(*)::int FROM ${S}.people_members m WHERE m.group_id = g.id) AS count FROM ${S}.people_groups g WHERE g.owner_id = $1 ORDER BY g.sort, g.created_at`,
      [me],
    );
    const schedules = await pool.query(
      `SELECT p.*, m.user_id, m.nickname, m.group_id, m.role_title, u.full_name, u.profile_image, w.wallet_id
         FROM ${S}.payouts p JOIN ${S}.people_members m ON m.id = p.member_id JOIN ${S}.users u ON u.id = m.user_id
         LEFT JOIN LATERAL (SELECT wallet_id FROM ${S}.wallets WHERE user_id = u.id ORDER BY created_at ASC NULLS LAST LIMIT 1) w ON true
        WHERE p.owner_id = $1 ORDER BY (p.active AND NOT p.paused_by_admin) DESC, p.awaiting DESC, p.next_run_at`,
      [me],
    );
    const people = await pool.query(`SELECT ${MEMBER_COLS} ${memberFrom} WHERE m.owner_id = $1 ORDER BY m.favourite DESC, m.sort, m.created_at`, [me]);
    const t = await one<any>(
      `SELECT COALESCE(sum(amount) FILTER (WHERE status = 'done' AND ran_at > now() - interval '30 days'), 0)::text AS last30,
              (SELECT COALESCE(sum(CASE every WHEN 'week' THEN amount * 4.33 WHEN '2weeks' THEN amount * 2.17 WHEN 'days' THEN amount * 30.0 / GREATEST(every_days, 1) WHEN 'once' THEN 0 ELSE amount END), 0)::numeric(20,2)::text
                 FROM ${S}.payouts WHERE owner_id = $1 AND active AND NOT paused_by_admin) AS monthly
         FROM ${S}.payout_runs WHERE owner_id = $1`,
      [me],
    );
    res.json({ success: true, data: { groups: groups.rows, schedules: schedules.rows, people: people.rows, totals: t, bankLinked: await hasBankLink(me) } });
  }),
);

peopleRouter.post(
  '/schedules',
  moneyLimiter,
  validate({ body: scheduleBody }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const b = req.body as z.infer<typeof scheduleBody>;
    assertMaxTransfer(b.amount);
    await requireSecondFactor(me, b.totp);
    if (b.source === 'bank' && !(await hasBankLink(me))) throw badRequest('BANK_NOT_LINKED', 'Link your TalerBank account first');
    if (b.groupId) await ownGroup(b.groupId, me);
    let userId = b.userId;
    if (!userId) {
      const r = await resolveRecipient(b.who!);
      if (!r) throw notFound('No wallet found for that ID or e-mail', 'RECIPIENT_NOT_FOUND');
      userId = String(r.user_id);
    } else if (!(await one(`SELECT 1 FROM ${S}.users WHERE id = $1 AND status = 'active'`, [userId]))) throw notFound('User not found');
    if (String(userId) === String(me)) throw badRequest('SELF', 'You cannot add yourself');
    const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.payouts WHERE owner_id = $1 AND active`, [me]);
    if ((n?.n ?? 0) >= 100) throw badRequest('TOO_MANY_PAYOUTS', 'Up to 100 recurring transfers');
    // The person joins your people (once); a chosen category files them there.
    const m = await one<any>(
      `INSERT INTO ${S}.people_members (group_id, owner_id, user_id) VALUES ($1, $2, $3)
       ON CONFLICT (owner_id, user_id) DO UPDATE SET group_id = COALESCE(EXCLUDED.group_id, ${S}.people_members.group_id) RETURNING id`,
      [b.groupId ?? null, me, userId],
    );
    const start = b.startAt ? new Date(b.startAt) : new Date();
    const p = await one<any>(
      `INSERT INTO ${S}.payouts (owner_id, member_id, amount, source, dest, every, every_days, next_run_at, title, ends, end_date, max_runs, auto, remind_before)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [me, m.id, b.amount, b.source, b.dest, b.every, b.every === 'days' ? b.everyDays : null, start, b.title || null, b.ends, b.ends === 'until' ? b.endDate : null, b.ends === 'count' ? b.maxRuns : null, b.auto, b.remindBefore ?? null],
    );
    await audit({ userId: me, action: 'people.schedule_created', entityType: 'payout', entityId: p.id, details: { amount: b.amount, every: b.every, to: userId, ends: b.ends } }, req);
    if (b.auto && start.getTime() <= Date.now() + 60_000) await runPayouts([p.id]);
    res.status(201).json({ success: true, data: { id: p.id, memberId: m.id } });
  }),
);

peopleRouter.put(
  '/schedules/:id',
  validate({
    params: z.object({ id: idParam }).strict(),
    body: z
      .object({
        title: z.string().trim().max(60).nullable().optional(),
        amount: amountSchema.optional(),
        every: z.enum(EVERY).optional(),
        everyDays: z.number().int().min(1).max(365).nullable().optional(),
        nextAt: z.string().datetime().optional(),
        ends: z.enum(['never', 'until', 'count']).optional(),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        maxRuns: z.number().int().min(1).max(1000).nullable().optional(),
        source: z.enum(['wallet', 'bank']).optional(),
        dest: z.enum(['wallet', 'bank']).optional(),
        auto: z.boolean().optional(),
        remindBefore: z.number().int().min(0).max(30).nullable().optional(),
        active: z.boolean().optional(),
        groupId: idParam.nullable().optional(),
        totp: totpCode.optional(),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const p = await one<any>(`SELECT * FROM ${S}.payouts WHERE id = $1 AND owner_id = $2`, [req.params.id, me]);
    if (!p) throw notFound('Transfer not found');
    const b = req.body;
    if ((b.amount && toCents(b.amount) > toCents(p.amount)) || (b.active && !p.active)) await requireSecondFactor(me, b.totp);
    if (b.amount) assertMaxTransfer(b.amount);
    if (b.source === 'bank' && !(await hasBankLink(me))) throw badRequest('BANK_NOT_LINKED', 'Link your TalerBank account first');
    if (b.groupId) await ownGroup(b.groupId, me);
    const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
    await pool.query(
      `UPDATE ${S}.payouts SET
         title = CASE WHEN $2 THEN $3 ELSE title END, amount = COALESCE($4, amount), every = COALESCE($5, every),
         every_days = CASE WHEN $6 THEN $7 ELSE every_days END, next_run_at = COALESCE($8, next_run_at),
         ends = COALESCE($9, ends), end_date = CASE WHEN $10 THEN $11::date ELSE end_date END, max_runs = CASE WHEN $12 THEN $13 ELSE max_runs END,
         source = COALESCE($14, source), dest = COALESCE($15, dest), auto = COALESCE($16, auto),
         remind_before = CASE WHEN $17 THEN $18 ELSE remind_before END,
         active = COALESCE($19, active), finished_at = CASE WHEN $19 THEN NULL ELSE finished_at END
       WHERE id = $1`,
      [
        p.id, has('title'), b.title ?? null, b.amount ?? null, b.every ?? null, has('everyDays'), b.everyDays ?? null, b.nextAt ?? null,
        b.ends ?? null, has('endDate'), b.endDate ?? null, has('maxRuns'), b.maxRuns ?? null, b.source ?? null, b.dest ?? null, b.auto ?? null,
        has('remindBefore'), b.remindBefore ?? null, b.active ?? null,
      ],
    );
    // Turned back on with a date already past: next try is in an hour, not a burst of back payments.
    if (b.active && new Date(p.next_run_at) < new Date()) await pool.query(`UPDATE ${S}.payouts SET next_run_at = now() + interval '1 hour', awaiting = false WHERE id = $1`, [p.id]);
    if (has('groupId')) await pool.query(`UPDATE ${S}.people_members SET group_id = $2 WHERE id = $1`, [p.member_id, b.groupId ?? null]);
    await audit({ userId: me, action: 'people.payout_changed', entityType: 'payout', entityId: p.id, details: { ...b, totp: undefined } }, req);
    res.json({ success: true });
  }),
);

/** Pay this one now (early, or a remind-only payment that's due); the schedule moves on. */
peopleRouter.post(
  '/schedules/:id/pay-now',
  moneyLimiter,
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ totp: totpCode.optional() }).strict() }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    await requireSecondFactor(me, req.body.totp);
    const p = await one<any>(
      `SELECT p.*, m.user_id AS member_user_id FROM ${S}.payouts p JOIN ${S}.people_members m ON m.id = p.member_id WHERE p.id = $1 AND p.owner_id = $2`,
      [req.params.id, me],
    );
    if (!p) throw notFound('Transfer not found');
    if (p.paused_by_admin) throw badRequest('PAUSED_BY_ADMIN', 'The team paused this payment');
    const r = await deliver({ ownerId: me, memberId: p.member_id, memberUserId: p.member_user_id, amount: fromCents(toCents(p.amount)), source: p.source, dest: p.dest, kind: 'scheduled', note: p.title ?? p.note, payoutId: p.id });
    if (r.status === 'failed') throw badRequest(r.code ?? 'TRANSFER_FAILED', r.error ?? 'The transfer failed');
    if (r.status === 'done') await advance(p, true);
    res.json({ success: true, data: r });
  }),
);

/** Skip the next date (e.g. paid by hand this time). */
peopleRouter.post(
  '/schedules/:id/skip',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const p = await one<any>(`SELECT * FROM ${S}.payouts WHERE id = $1 AND owner_id = $2`, [req.params.id, req.auth!.userId]);
    if (!p) throw notFound('Transfer not found');
    await pool.query(`INSERT INTO ${S}.payout_runs (payout_id, owner_id, member_id, amount, kind, status) VALUES ($1, $2, $3, $4, 'skipped', 'skipped')`, [p.id, p.owner_id, p.member_id, p.amount]);
    await advance(p, false);
    res.json({ success: true });
  }),
);

// -------------------------------------------------------------------- admin
/** Admins: who sends regularly to whom, how much, and the power to pause it. */
export const peopleAdminRouter = Router();
peopleAdminRouter.use(requirePerm('people.oversee'));

peopleAdminRouter.get(
  '/owners',
  validate({ query: z.object({ q: z.string().trim().max(60).optional() }).strict() }),
  ah(async (req, res) => {
    const q = (req.query as any).q;
    const r = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.profile_image, u.role,
              (SELECT count(*)::int FROM ${S}.people_groups g WHERE g.owner_id = u.id) AS groups,
              (SELECT count(*)::int FROM ${S}.people_members m WHERE m.owner_id = u.id) AS members,
              (SELECT count(*)::int FROM ${S}.payouts p WHERE p.owner_id = u.id AND p.active) AS active_payouts,
              (SELECT count(*)::int FROM ${S}.payouts p WHERE p.owner_id = u.id AND p.paused_by_admin) AS paused,
              (SELECT COALESCE(sum(r.amount), 0)::text FROM ${S}.payout_runs r WHERE r.owner_id = u.id AND r.status = 'done' AND r.ran_at > now() - interval '30 days') AS last30,
              (SELECT count(*)::int FROM ${S}.payout_runs r WHERE r.owner_id = u.id AND r.status = 'failed' AND r.ran_at > now() - interval '30 days') AS failed30
         FROM ${S}.users u WHERE EXISTS (SELECT 1 FROM ${S}.people_groups g WHERE g.owner_id = u.id)
          AND ($1::text IS NULL OR u.full_name ILIKE $1 OR u.email ILIKE $1)
        ORDER BY last30 DESC, members DESC LIMIT 200`,
      [q ? `%${q}%` : null],
    );
    const t = await one<any>(
      `SELECT (SELECT count(*)::int FROM ${S}.payouts WHERE active) AS active, (SELECT count(*)::int FROM ${S}.people_members) AS members,
              (SELECT COALESCE(sum(amount), 0)::text FROM ${S}.payout_runs WHERE status = 'done' AND ran_at > now() - interval '30 days') AS last30`,
    );
    res.json({ success: true, data: { owners: r.rows, totals: t } });
  }),
);

peopleAdminRouter.get(
  '/owners/:id',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const u = await one<any>(`SELECT id, full_name, email, profile_image, role FROM ${S}.users WHERE id = $1`, [req.params.id]);
    if (!u) throw notFound('User not found');
    const runs = await pool.query(
      `SELECT r.id, r.amount, r.kind, r.status, r.error, r.ran_at, x.full_name FROM ${S}.payout_runs r LEFT JOIN ${S}.users x ON x.id = r.member_user_id
        WHERE r.owner_id = $1 ORDER BY r.ran_at DESC LIMIT 100`,
      [u.id],
    );
    res.json({ success: true, data: { owner: u, groups: await groupsOf(u.id), runs: runs.rows } });
  }),
);

peopleAdminRouter.post(
  '/payouts/:id/pause',
  validate({ params: z.object({ id: idParam }).strict(), body: z.object({ paused: z.boolean(), note: z.string().trim().max(300).optional() }).strict() }),
  ah(async (req, res) => {
    const p = await one<any>(`UPDATE ${S}.payouts SET paused_by_admin = $2, admin_note = $3 WHERE id = $1 RETURNING owner_id, amount`, [req.params.id, req.body.paused, req.body.note ?? null]);
    if (!p) throw notFound('Transfer not found');
    await notifyBi(
      undefined,
      p.owner_id,
      'payout_admin',
      req.body.paused ? ['A recurring transfer was paused by the team', req.body.note ?? ''] : ['Your recurring transfer is running again', ''],
      req.body.paused ? ['الإدارة أوقفت تحويل دوري', req.body.note ?? 'تواصل مع الدعم للتفاصيل.'] : ['رجع التحويل الدوري يشتغل', ''],
      { link: '/app/people' },
    );
    await audit({ userId: req.auth!.userId, action: req.body.paused ? 'admin.payout_paused' : 'admin.payout_resumed', entityType: 'payout', entityId: req.params.id, details: { note: req.body.note } }, req);
    res.json({ success: true });
  }),
);


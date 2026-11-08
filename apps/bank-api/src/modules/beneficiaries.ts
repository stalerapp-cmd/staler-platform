import { Router } from 'express';
import { z } from 'zod';
import { one, pool, S } from '../lib/db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { uuid, validate } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { maskName, resolveRecipient } from './banking.js';
import { assertNotBlocked, blockedSql } from './scheduled.js';

/**
 * Saved beneficiaries: the accounts you send to often, with a name you choose.
 * Picking one fills the transfer form; nothing is sent without the usual checks.
 */
export const beneficiariesRouter = Router();
beneficiariesRouter.use('/beneficiaries', requireAuth);

const nick = z.string().trim().max(40).optional().nullable();

beneficiariesRouter.get(
  '/beneficiaries',
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const r = await pool.query(
      `SELECT b.id, b.nickname, b.favourite, b.created_at, u.id AS user_id, a.iban, a.account_number, u.full_name, u.username, u.customer_type, u.business_name,
              (u.status <> 'active' OR a.is_locked) AS unavailable, ${blockedSql('b.owner_id', 'u.id')} AS blocked,
              (SELECT max(t.created_at) FROM ${S}.transactions t JOIN ${S}.bank_accounts f ON f.id = t.from_account_id
                WHERE f.user_id = b.owner_id AND t.to_account_id = b.account_id AND t.status = 'completed') AS last_used,
              (SELECT count(*)::int FROM ${S}.transactions t JOIN ${S}.bank_accounts f ON f.id = t.from_account_id
                WHERE f.user_id = b.owner_id AND t.to_account_id = b.account_id AND t.status = 'completed') AS times
         FROM ${S}.beneficiaries b JOIN ${S}.bank_accounts a ON a.id = b.account_id JOIN ${S}.users u ON u.id = a.user_id
        WHERE b.owner_id = $1
        ORDER BY b.favourite DESC, last_used DESC NULLS LAST, b.created_at DESC`,
      [me],
    );
    res.json({
      success: true,
      data: {
        beneficiaries: r.rows.map((x) => ({
          id: x.id,
          userId: x.user_id,
          nickname: x.nickname,
          favourite: x.favourite,
          holder: maskName(x.full_name),
          username: x.username,
          iban: x.iban,
          accountNumber: x.account_number,
          kind: x.customer_type ?? 'personal',
          business: x.customer_type && x.customer_type !== 'personal' ? x.business_name : null,
          lastUsed: x.last_used,
          times: x.times,
          unavailable: x.unavailable || x.blocked,
        })),
      },
    });
  }),
);

beneficiariesRouter.post(
  '/beneficiaries',
  validate({
    body: z
      .object({ to: z.string().trim().min(3).max(64).optional(), userId: uuid.optional(), nickname: nick, favourite: z.boolean().optional() })
      .strict()
      .refine((b) => b.to || b.userId, 'Who should be saved?'),
  }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    // From a chat: the person's main account.
    const r = req.body.userId
      ? await one<any>(
          `SELECT a.id, a.user_id, u.full_name FROM ${S}.users u JOIN ${S}.bank_accounts a ON a.user_id = u.id
            WHERE u.id = $1 AND u.role = 'user' AND u.status = 'active' ORDER BY a.is_primary DESC, a.created_at ASC LIMIT 1`,
          [req.body.userId],
        )
      : await resolveRecipient(req.body.to!);
    if (!r) throw notFound('User not found');
    if (String(r.user_id) === String(me)) throw badRequest('OWN_ACCOUNT', 'This is your own account');
    await assertNotBlocked(me, String(r.user_id));
    const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.beneficiaries WHERE owner_id = $1`, [me]);
    if ((n?.n ?? 0) >= 200) throw badRequest('TOO_MANY_BENEFICIARIES', 'Up to 200 saved beneficiaries');
    const b = await one<any>(
      `INSERT INTO ${S}.beneficiaries (owner_id, account_id, nickname, favourite) VALUES ($1, $2, $3, $4)
       ON CONFLICT (owner_id, account_id) DO UPDATE SET nickname = COALESCE(EXCLUDED.nickname, ${S}.beneficiaries.nickname) RETURNING id`,
      [me, r.id, req.body.nickname || null, req.body.favourite ?? false],
    );
    res.status(201).json({ success: true, data: { id: b.id, holder: maskName(r.full_name) } });
  }),
);

beneficiariesRouter.patch(
  '/beneficiaries/:id',
  validate({ params: z.object({ id: uuid }).strict(), body: z.object({ nickname: nick, favourite: z.boolean().optional() }).strict() }),
  ah(async (req, res) => {
    const r = await one(
      `UPDATE ${S}.beneficiaries SET nickname = CASE WHEN $3::boolean THEN $4 ELSE nickname END, favourite = COALESCE($5, favourite)
        WHERE id = $1 AND owner_id = $2 RETURNING id`,
      [req.params.id, req.auth!.userId, req.body.nickname !== undefined, req.body.nickname || null, req.body.favourite ?? null],
    );
    if (!r) throw notFound('Beneficiary not found');
    res.json({ success: true });
  }),
);

beneficiariesRouter.delete(
  '/beneficiaries/:id',
  validate({ params: z.object({ id: uuid }).strict() }),
  ah(async (req, res) => {
    const r = await one(`DELETE FROM ${S}.beneficiaries WHERE id = $1 AND owner_id = $2 RETURNING id`, [req.params.id, req.auth!.userId]);
    if (!r) throw notFound('Beneficiary not found');
    res.json({ success: true });
  }),
);

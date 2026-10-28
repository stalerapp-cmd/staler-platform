import { Router } from 'express';
import { z } from 'zod';
import { one, pool, S } from '../lib/db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { idParam } from './commerce.js';

/** Saved people: name them your way, find them fast, pay or message in one tap. */
export const contactsRouter = Router();
contactsRouter.use(requireAuth);

const COLS = `c.id, c.nickname, c.favourite, c.created_at, u.id AS user_id, u.full_name, u.profile_image, u.role, w.wallet_id`;

contactsRouter.get(
  '/',
  validate({ query: z.object({ q: z.string().trim().max(64).optional() }).strict() }),
  ah(async (req, res) => {
    const q = req.query.q ? `%${String(req.query.q).replace(/[\\%_]/g, (m) => '\\' + m)}%` : null;
    const r = await pool.query(
      `SELECT ${COLS} FROM ${S}.contacts c JOIN ${S}.users u ON u.id = c.contact_user_id LEFT JOIN ${S}.wallets w ON w.user_id = u.id
        WHERE c.owner_id = $1 AND u.status = 'active'
          AND ($2::text IS NULL OR c.nickname ILIKE $2 OR u.full_name ILIKE $2 OR w.wallet_id ILIKE $2)
        ORDER BY c.favourite DESC, lower(COALESCE(c.nickname, u.full_name)) LIMIT 500`,
      [req.auth!.userId, q],
    );
    res.json({ success: true, data: { contacts: r.rows } });
  }),
);

contactsRouter.post(
  '/',
  validate({
    body: z
      .object({
        userId: idParam.optional(),
        walletId: z.string().trim().max(80).optional(),
        email: z.string().trim().email().max(254).optional(),
        nickname: z.string().trim().max(60).optional(),
      })
      .strict()
      .refine((b) => b.userId || b.walletId || b.email, 'Who should be saved?'),
  }),
  ah(async (req, res) => {
    const me = req.auth!.userId;
    const b = req.body;
    const u = await one<any>(
      `SELECT u.id FROM ${S}.users u LEFT JOIN ${S}.wallets w ON w.user_id = u.id
        WHERE u.status = 'active' AND u.role <> 'admin' AND (u.id::text = $1 OR w.wallet_id = $2 OR lower(u.email) = lower($3)) LIMIT 1`,
      [b.userId ?? '', b.walletId ?? '', b.email ?? ''],
    );
    if (!u) throw notFound('No S-Taler account found', 'CONTACT_NOT_FOUND');
    if (String(u.id) === String(me)) throw badRequest('SELF', 'That’s you');
    const c = await one(
      `INSERT INTO ${S}.contacts (owner_id, contact_user_id, nickname) VALUES ($1, $2, $3)
       ON CONFLICT (owner_id, contact_user_id) DO UPDATE SET nickname = COALESCE(EXCLUDED.nickname, ${S}.contacts.nickname) RETURNING id`,
      [me, u.id, b.nickname || null],
    );
    res.status(201).json({ success: true, data: { id: (c as any).id } });
  }),
);

contactsRouter.patch(
  '/:id',
  validate({
    params: z.object({ id: idParam }).strict(),
    body: z.object({ nickname: z.string().trim().max(60).nullable().optional(), favourite: z.boolean().optional() }).strict(),
  }),
  ah(async (req, res) => {
    const r = await pool.query(
      `UPDATE ${S}.contacts SET nickname = CASE WHEN $3 THEN $4 ELSE nickname END, favourite = COALESCE($5, favourite) WHERE id = $1 AND owner_id = $2`,
      [req.params.id, req.auth!.userId, 'nickname' in req.body, req.body.nickname || null, req.body.favourite ?? null],
    );
    if (r.rowCount === 0) throw notFound('Contact not found');
    res.json({ success: true });
  }),
);

contactsRouter.delete(
  '/:id',
  validate({ params: z.object({ id: idParam }).strict() }),
  ah(async (req, res) => {
    const r = await pool.query(`DELETE FROM ${S}.contacts WHERE id = $1 AND owner_id = $2`, [req.params.id, req.auth!.userId]);
    if (r.rowCount === 0) throw notFound('Contact not found');
    res.json({ success: true });
  }),
);

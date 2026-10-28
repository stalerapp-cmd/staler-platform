import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { one, pool, S, tx } from '../lib/db.js';
import { sha256 } from '../lib/crypto.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { parseTalerAmount, talerAmount } from '../lib/money.js';
import { normalizeIban } from '../lib/iban.js';
import { pageQuery, validate } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { requireExchange } from '../middleware/auth.js';
import { integrationLimiter } from '../middleware/security.js';
import { assertMaxTransfer, exchangeAccount, move, notify } from './ledger.js';

/**
 * Taler Wire Gateway (subset) — used ONLY by the exchange operator (S-Taler)
 * to pay money out of the exchange account back to customers (wallet -> bank
 * deposits) and to read its incoming reserve transfers.
 */
export const wireRouter = Router();
wireRouter.use(integrationLimiter, requireExchange);

/** payto://iban/[BIC/]IBAN?receiver-name=... -> IBAN */
export function ibanFromPayto(payto: string): string {
  let u: URL;
  try {
    u = new URL(payto);
  } catch {
    throw badRequest('INVALID_PAYTO', 'credit_account must be a payto:// URI');
  }
  if (u.protocol !== 'payto:') throw badRequest('INVALID_PAYTO', 'credit_account must be a payto:// URI');
  const parts = (u.host + u.pathname).split('/').filter(Boolean);
  if (parts[0] !== 'iban' || parts.length < 2) throw badRequest('INVALID_PAYTO', 'Only payto://iban/ is supported');
  const iban = normalizeIban(decodeURIComponent(parts[parts.length - 1]!));
  // Format check only: legacy accounts may carry IBANs with non-standard check digits;
  // existence at this bank is what really matters and is checked by the caller.
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban)) throw badRequest('INVALID_IBAN', 'IBAN in credit_account is invalid');
  return iban;
}

wireRouter.get('/config', (_req, res) => {
  res.json({ name: 'taler-wire-gateway', version: '0:0:0', currency: env.CURRENCY, implementation: 'talerbank-v3' });
});

wireRouter.get(
  '/account',
  ah(async (_req, res) => {
    const ex = await exchangeAccount();
    const totals = await one(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE to_account_id = $1), 0)::text AS total_in,
              COALESCE(SUM(amount) FILTER (WHERE from_account_id = $1), 0)::text AS total_out
         FROM ${S}.transactions WHERE (to_account_id = $1 OR from_account_id = $1) AND status = 'completed'`,
      [ex.id],
    );
    res.json({ success: true, data: { iban: ex.iban, payto: ex.payto_uri, balance: ex.balance, currency: env.CURRENCY, ...totals } });
  }),
);

const transferBody = z
  .object({
    request_uid: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
    amount: z.string().max(40),
    credit_account: z.string().max(512),
    subject: z.string().trim().max(140).optional(),
    wtid: z.string().max(64).optional(),
    exchange_base_url: z.string().max(512).optional(),
  })
  .strict();

wireRouter.post(
  '/transfer',
  validate({ body: transferBody }),
  ah(async (req, res) => {
    const { request_uid, credit_account, subject, wtid } = req.body;
    let amount: string;
    try {
      const parsed = parseTalerAmount(req.body.amount);
      if (parsed.currency !== env.CURRENCY) throw new Error('currency');
      amount = parsed.value;
    } catch {
      throw badRequest('INVALID_AMOUNT', `amount must look like ${env.CURRENCY}:10.00`);
    }
    if (amount === '0.00') throw badRequest('INVALID_AMOUNT', 'amount must be positive');
    assertMaxTransfer(amount);
    const iban = ibanFromPayto(credit_account);
    const reqHash = sha256(JSON.stringify({ amount, iban, subject: subject ?? null, wtid: wtid ?? null }));

    const prior = await one<any>(`SELECT * FROM ${S}.wire_transfers WHERE request_uid = $1`, [request_uid]);
    if (prior) {
      if (prior.request_hash !== reqHash) throw conflict('REQUEST_UID_REUSED', 'request_uid already used with different data');
      return res.json({ success: true, data: { row_id: prior.id, transaction_id: prior.transaction_id, status: prior.status, timestamp: prior.executed_at, replay: true } });
    }

    const out = await tx(async (c) => {
      const ex = await exchangeAccount(c);
      const target = await one<any>(
        `SELECT a.id, a.user_id, u.full_name FROM ${S}.bank_accounts a JOIN ${S}.users u ON u.id = a.user_id
          WHERE a.iban = $1 AND a.is_taler_exchange = false`,
        [iban],
        c,
      );
      if (!target) throw new AppError(404, 'CREDIT_ACCOUNT_UNKNOWN', 'Credit account does not exist at this bank');
      const t = await move(c, {
        fromAccountId: ex.id,
        toAccountId: target.id,
        amount,
        type: 'taler_deposit',
        subject: subject ?? `Wallet deposit ${wtid ?? ''}`.trim(),
        requestUid: request_uid,
        metadata: { wtid: wtid ?? null, via: 'wire-gateway' },
      });
      const wt = await one(
        `INSERT INTO ${S}.wire_transfers (from_account_id, to_payto_uri, to_iban, to_name, amount, currency, subject, status, executed_at,
                                          request_uid, transaction_id, credit_account_id, request_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', now(), $8, $9, $10, $11) RETURNING id, executed_at`,
        [ex.id, credit_account, iban, target.full_name, amount, env.CURRENCY, t.subject, request_uid, t.id, target.id, reqHash],
        c,
      );
      await notify(c, target.user_id, 'wallet_deposit', 'Money from your wallet', `${amount} ${env.CURRENCY} arrived from S-Taler`, { transactionId: t.id });
      return { wt, t };
    });
    await audit({ action: 'wire.transfer', entityType: 'transaction', entityId: out.t.id, details: { amount, iban } }, req);
    res.json({ success: true, data: { row_id: out.wt.id, transaction_id: out.t.id, status: 'completed', timestamp: out.wt.executed_at } });
  }),
);

wireRouter.get(
  '/transfer/:requestUid',
  validate({ params: z.object({ requestUid: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }).strict() }),
  ah(async (req, res) => {
    const wt = await one<any>(`SELECT id, status, amount, to_iban, executed_at, transaction_id FROM ${S}.wire_transfers WHERE request_uid = $1`, [
      req.params.requestUid,
    ]);
    if (!wt) throw notFound('Unknown transfer', 'TRANSFER_NOT_FOUND');
    res.json({ success: true, data: { ...wt, amount: talerAmount(wt.amount) } });
  }),
);

/** Lets the exchange confirm that a given reserve was funded (used by S-Taler's reconciler). */
wireRouter.get(
  '/reserves/:reservePub',
  validate({ params: z.object({ reservePub: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{52}$/) }).strict() }),
  ah(async (req, res) => {
    const r = await one<any>(`SELECT reserve_pub, amount, status, created_at FROM ${S}.reserves WHERE reserve_pub = $1`, [req.params.reservePub]);
    if (!r) throw notFound('Unknown reserve', 'RESERVE_NOT_FOUND');
    res.json({ success: true, data: r });
  }),
);

wireRouter.get(
  '/history/incoming',
  validate({ query: pageQuery }),
  ah(async (req, res) => {
    const ex = await exchangeAccount();
    const q = req.query as any;
    const r = await pool.query(
      `SELECT t.id AS row_id, t.amount, t.subject AS reserve_pub, t.created_at AS date, fa.payto_uri AS debit_account
         FROM ${S}.transactions t JOIN ${S}.bank_accounts fa ON fa.id = t.from_account_id
        WHERE t.to_account_id = $1 AND t.type = 'taler_withdraw' AND t.status = 'completed'
        ORDER BY t.created_at DESC LIMIT $2 OFFSET $3`,
      [ex.id, q.limit, q.offset],
    );
    res.json({ incoming_transactions: r.rows.map((x) => ({ ...x, type: 'RESERVE', amount: talerAmount(x.amount) })), credit_account: ex.payto_uri });
  }),
);

wireRouter.get(
  '/history/outgoing',
  validate({ query: pageQuery }),
  ah(async (req, res) => {
    const q = req.query as any;
    const r = await pool.query(
      `SELECT id AS row_id, amount, to_payto_uri AS credit_account, subject, executed_at AS date, request_uid
         FROM ${S}.wire_transfers ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [q.limit, q.offset],
    );
    res.json({ outgoing_transactions: r.rows.map((x) => ({ ...x, amount: talerAmount(x.amount) })) });
  }),
);

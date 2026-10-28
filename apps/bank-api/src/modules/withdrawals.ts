import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { one, pool, S, tx } from '../lib/db.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { amountSchema, cmp, talerAmount } from '../lib/money.js';
import { totpCode, uuid, validate } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { requireAuth, requireExchange } from '../middleware/auth.js';
import { integrationLimiter, moneyLimiter } from '../middleware/security.js';
import { assertDailyLimit, assertMaxTransfer, exchangeAccount, move, notify } from './ledger.js';
import { requireSecondFactor } from './mfa.js';
import { maskName, ownAccount } from './banking.js';

/** Ed25519 public key, Crockford base32 (52 chars) — what a Taler wallet sends. */
export const reservePub = z.string().trim().toUpperCase().regex(/^[0-9A-HJKMNP-TV-Z]{52}$/, 'Invalid reserve public key');

const host = () => new URL(env.PUBLIC_URL).host;
export const withdrawUri = (opId: string) => `taler://withdraw/${host()}/taler-integration/${opId}`;

function effectiveStatus(op: any): string {
  if ((op.status === 'pending' || op.status === 'selected') && op.expires_at && new Date(op.expires_at) < new Date()) return 'aborted';
  return op.status;
}

export function opView(op: any) {
  const status = effectiveStatus(op);
  return {
    operation_id: op.operation_id,
    status,
    amount: talerAmount(op.amount, op.currency),
    amount_value: op.amount,
    currency: op.currency,
    selection_done: status === 'selected' || status === 'confirmed',
    transfer_done: status === 'confirmed',
    aborted: status === 'aborted',
    reserve_pub: op.reserve_pub ?? null,
    wallet_ref: op.wallet_ref ?? null,
    taler_withdraw_uri: withdrawUri(op.operation_id),
    created_at: op.created_at,
    expires_at: op.expires_at,
    confirmed_at: op.confirmed_at ?? null,
  };
}

/** Pushes a signed confirmation to S-Taler (best effort; S-Taler also polls). */
export async function sendWebhook(event: string, payload: Record<string, unknown>) {
  if (!env.STALER_WEBHOOK_URL || !env.WEBHOOK_SECRET) return;
  const body = JSON.stringify({ event, id: crypto.randomUUID(), created_at: new Date().toISOString(), data: payload });
  for (let attempt = 0; attempt < 3; attempt++) {
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = crypto.createHmac('sha256', env.WEBHOOK_SECRET).update(`${ts}.${body}`).digest('hex');
    try {
      const r = await fetch(env.STALER_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-TalerBank-Signature': `t=${ts},v1=${sig}` },
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) return;
      logger.warn({ status: r.status, event }, 'webhook rejected');
    } catch (err) {
      logger.warn({ err: (err as Error).message, event }, 'webhook delivery failed');
    }
    await new Promise((r) => setTimeout(r, 500 * 3 ** attempt));
  }
}

// =================================================================== customer
export const withdrawalsRouter = Router();
withdrawalsRouter.use(requireAuth);

withdrawalsRouter.post(
  '/',
  moneyLimiter,
  validate({ body: z.object({ accountId: uuid, amount: amountSchema }).strict() }),
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    const { accountId, amount } = req.body;
    assertMaxTransfer(amount);
    const acc = await ownAccount(userId, accountId);
    if (acc.is_locked) throw forbidden('Account is frozen', 'ACCOUNT_LOCKED');
    if (cmp(acc.balance, amount) < 0) throw conflict('INSUFFICIENT_FUNDS', 'Insufficient funds');
    const op = await one(
      `INSERT INTO ${S}.withdrawal_operations (account_id, amount, currency, status, expires_at)
       VALUES ($1, $2, $3, 'pending', now() + interval '30 minutes') RETURNING *`,
      [acc.id, amount, env.CURRENCY],
    );
    await audit({ userId, action: 'withdrawal.created', entityType: 'withdrawal', entityId: op.operation_id, details: { amount } }, req);
    res.status(201).json({ success: true, data: { withdrawal: opView(op) } });
  }),
);

withdrawalsRouter.get(
  '/',
  ah(async (req, res) => {
    const r = await pool.query(
      `SELECT w.* FROM ${S}.withdrawal_operations w JOIN ${S}.bank_accounts a ON a.id = w.account_id
        WHERE a.user_id = $1 ORDER BY w.created_at DESC LIMIT 30`,
      [req.auth!.userId],
    );
    res.json({ success: true, data: { withdrawals: r.rows.map(opView) } });
  }),
);

async function ownOp(userId: string, opId: string, c?: any) {
  const op = await one<any>(
    `SELECT w.* FROM ${S}.withdrawal_operations w JOIN ${S}.bank_accounts a ON a.id = w.account_id
      WHERE w.operation_id = $1 AND a.user_id = $2 ${c ? 'FOR UPDATE OF w' : ''}`,
    [opId, userId],
    c,
  );
  if (!op) throw notFound('Withdrawal not found');
  return op;
}

const opParams = z.object({ opId: uuid }).strict();

withdrawalsRouter.get(
  '/:opId',
  validate({ params: opParams }),
  ah(async (req, res) => {
    res.json({ success: true, data: { withdrawal: opView(await ownOp(req.auth!.userId, req.params.opId!)) } });
  }),
);

/**
 * The customer approves the transfer to the exchange. Funds move atomically:
 * customer -> exchange account (subject = reserve public key), a reserve is
 * opened, and S-Taler is notified so it can credit the wallet.
 */
withdrawalsRouter.post(
  '/:opId/confirm',
  moneyLimiter,
  validate({ params: opParams, body: z.object({ totp: totpCode.optional() }).strict() }),
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    await requireSecondFactor(userId, req.body.totp);
    const result = await tx(async (c) => {
      const op = await ownOp(userId, req.params.opId!, c);
      const status = effectiveStatus(op);
      if (status === 'confirmed') return { op, already: true };
      if (status === 'aborted') throw conflict('WITHDRAWAL_ABORTED', 'This withdrawal was cancelled or has expired');
      if (status !== 'selected' || !op.reserve_pub) throw conflict('WALLET_NOT_SELECTED', 'Scan the QR code with your S-Taler wallet first');
      await assertDailyLimit(c, userId, op.amount);
      const ex = await exchangeAccount(c);
      const t = await move(c, {
        fromAccountId: op.account_id,
        toAccountId: ex.id,
        amount: op.amount,
        type: 'taler_withdraw',
        subject: op.reserve_pub,
        initiatedBy: userId,
        metadata: { withdrawalOperation: op.operation_id, walletRef: op.wallet_ref },
      });
      await c.query(
        `INSERT INTO ${S}.reserves (reserve_pub, account_id, amount, currency, status, transaction_id, source)
         VALUES ($1, $2, $3, $4, 'open', $5, 'withdrawal_operation')`,
        [op.reserve_pub, op.account_id, op.amount, op.currency, t.id],
      );
      const updated = await one(
        `UPDATE ${S}.withdrawal_operations SET status = 'confirmed', confirmed_at = now(), transaction_id = $2
          WHERE id = $1 RETURNING *`,
        [op.id, t.id],
        c,
      );
      await notify(c, userId, 'withdrawal_confirmed', 'Sent to wallet', `${op.amount} ${op.currency} sent to your S-Taler wallet`, {
        operationId: op.operation_id,
      });
      return { op: updated, already: false };
    });
    if (!result.already) {
      await audit({ userId, action: 'withdrawal.confirmed', entityType: 'withdrawal', entityId: req.params.opId }, req);
      void sendWebhook('withdrawal.confirmed', {
        operation_id: result.op.operation_id,
        reserve_pub: result.op.reserve_pub,
        amount: result.op.amount,
        currency: result.op.currency,
        wallet_ref: result.op.wallet_ref,
      });
    }
    res.json({ success: true, data: { withdrawal: opView(result.op) } });
  }),
);

withdrawalsRouter.post(
  '/:opId/abort',
  validate({ params: opParams }),
  ah(async (req, res) => {
    const op = await tx(async (c) => {
      const o = await ownOp(req.auth!.userId, req.params.opId!, c);
      if (o.status === 'confirmed') throw conflict('ALREADY_CONFIRMED', 'Money was already sent');
      return one(`UPDATE ${S}.withdrawal_operations SET status = 'aborted', aborted_at = now() WHERE id = $1 RETURNING *`, [o.id], c);
    });
    void sendWebhook('withdrawal.aborted', { operation_id: op.operation_id, wallet_ref: op.wallet_ref });
    res.json({ success: true, data: { withdrawal: opView(op) } });
  }),
);

// ======================================================= Taler integration API
export const integrationRouter = Router();
integrationRouter.use(integrationLimiter);

integrationRouter.get('/config', (_req, res) => {
  res.json({ name: 'taler-bank-integration', version: '3:0:0', currency: env.CURRENCY, implementation: 'talerbank-v3' });
});

/** Public status (the operation id itself is an unguessable 122-bit secret). */
integrationRouter.get(
  '/withdrawal-operation/:opId',
  validate({ params: opParams }),
  ah(async (req, res) => {
    const op = await one<any>(
      `SELECT w.*, u.full_name FROM ${S}.withdrawal_operations w
         JOIN ${S}.bank_accounts a ON a.id = w.account_id JOIN ${S}.users u ON u.id = a.user_id
        WHERE w.operation_id = $1`,
      [req.params.opId],
    );
    if (!op) throw notFound('Unknown withdrawal operation', 'OPERATION_NOT_FOUND');
    const ex = await exchangeAccount();
    res.json({
      ...opView(op),
      account_holder: maskName(op.full_name),
      suggested_exchange: env.PUBLIC_URL,
      exchange_payto: ex.payto_uri,
      wire_types: ['iban'],
      confirm_transfer_url: `${env.PUBLIC_URL}/withdraw/${op.operation_id}`,
    });
  }),
);

/** The exchange operator (S-Taler) attaches the wallet's reserve key. */
integrationRouter.post(
  '/withdrawal-operation/:opId',
  requireExchange,
  validate({
    params: opParams,
    body: z
      .object({
        reserve_pub: reservePub,
        selected_exchange: z.string().max(512).optional(),
        wallet_ref: z.string().trim().max(64).regex(/^[A-Za-z0-9_.:-]*$/).optional(),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const out = await tx(async (c) => {
      const op = await one<any>(`SELECT * FROM ${S}.withdrawal_operations WHERE operation_id = $1 FOR UPDATE`, [req.params.opId], c);
      if (!op) throw notFound('Unknown withdrawal operation', 'OPERATION_NOT_FOUND');
      const status = effectiveStatus(op);
      if (status === 'aborted') throw conflict('WITHDRAWAL_ABORTED', 'Operation was aborted or expired');
      if (op.reserve_pub) {
        if (op.reserve_pub === req.body.reserve_pub) return op; // idempotent replay
        throw conflict('ALREADY_SELECTED', 'Another wallet already claimed this withdrawal');
      }
      const ex = await exchangeAccount(c);
      return one(
        `UPDATE ${S}.withdrawal_operations SET reserve_pub = $2, selected_exchange_account = $3, wallet_ref = $4,
                status = 'selected', selected_at = now() WHERE id = $1 RETURNING *`,
        [op.id, req.body.reserve_pub, ex.payto_uri, req.body.wallet_ref ?? null],
        c,
      );
    });
    res.json({ ...opView(out), transfer_done: out.status === 'confirmed' });
  }),
);

integrationRouter.post(
  '/withdrawal-operation/:opId/abort',
  requireExchange,
  validate({ params: opParams }),
  ah(async (req, res) => {
    const op = await tx(async (c) => {
      const o = await one<any>(`SELECT * FROM ${S}.withdrawal_operations WHERE operation_id = $1 FOR UPDATE`, [req.params.opId], c);
      if (!o) throw notFound('Unknown withdrawal operation', 'OPERATION_NOT_FOUND');
      if (o.status === 'confirmed') throw conflict('ALREADY_CONFIRMED', 'Transfer already done');
      return one(`UPDATE ${S}.withdrawal_operations SET status = 'aborted', aborted_at = now() WHERE id = $1 RETURNING *`, [o.id], c);
    });
    res.json(opView(op));
  }),
);


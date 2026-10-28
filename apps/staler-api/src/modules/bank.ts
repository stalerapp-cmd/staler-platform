import { Router, type Request } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { one, pool, S, tx } from '../lib/db.js';
import { codeHash, decrypt, encrypt, numericCode, randomToken, safeEqual } from '../lib/crypto.js';
import { codeMail, sendMail } from '../lib/mailer.js';
import { checkSmsCode, sendSmsCode, smsEnabled } from '../lib/sms.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { amountSchema, cmp } from '../lib/money.js';
import { idempotencyKey, otpCode, totpCode, validate } from '../lib/validate.js';
import { idempotent } from '../lib/idempotency.js';
import { audit } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { bank, BankRejected, BankUnreachable } from '../lib/bankClient.js';
import { newReserveKeypair } from '../lib/reserve.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter, codeLimiter, moneyLimiter } from '../middleware/security.js';
import { requireSecondFactor } from './mfa.js';
import { assertDailyLimit, assertMaxTransfer, credit, debit, notify, walletOfUser, writeLine } from './walletCore.js';

export const bankRouter = Router();

// ===================================================================== link
interface LinkRow {
  id: string;
  user_id: string;
  bank_token_enc: string;
  bank_iban: string;
  bank_holder: string;
  bank_payto: string;
  bank_token_expires_at: string;
  linked_via: string;
  created_at: string;
}

async function activeLink(userId: string): Promise<LinkRow | null> {
  return one<LinkRow>(
    `SELECT id, user_id, bank_token_enc, bank_iban, bank_holder, bank_payto, bank_token_expires_at, linked_via, created_at
       FROM ${S}.bank_accounts WHERE user_id = $1 AND status = 'active' AND bank_token_enc IS NOT NULL
        AND (bank_token_expires_at IS NULL OR bank_token_expires_at > now())
      ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
}
const linkToken = (l: LinkRow) => decrypt(l.bank_token_enc, `banklink:${l.user_id}`);

async function requireLink(userId: string): Promise<LinkRow> {
  const l = await activeLink(userId);
  if (!l) throw conflict('BANK_NOT_LINKED', 'Link your TalerBank account first');
  return l;
}

/** On a revoked/expired link the bank answers 409 BANK_LINK_REVOKED — forget the token locally too. */
async function onLinkError(userId: string, err: unknown) {
  if (err instanceof BankRejected && err.code === 'BANK_LINK_REVOKED') {
    await pool.query(`UPDATE ${S}.bank_accounts SET status = 'inactive', bank_token_enc = NULL WHERE user_id = $1 AND status = 'active'`, [userId]);
  }
}

async function storeLink(userId: string, via: string, result: Awaited<ReturnType<typeof bank.redeemLinkCode>>) {
  const w = await walletOfUser(userId);
  await tx(async (c) => {
    await c.query(`UPDATE ${S}.bank_accounts SET status = 'inactive', bank_token_enc = NULL WHERE user_id = $1 AND status = 'active'`, [userId]);
    await c.query(
      `INSERT INTO ${S}.bank_accounts (user_id, wallet_id, bank_username, bank_token_enc, bank_token_expires_at, bank_iban, bank_holder, bank_payto, linked_via, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')`,
      [
        userId,
        w.id,
        result.account.iban,
        encrypt(result.token, `banklink:${userId}`),
        result.expiresAt,
        result.account.iban,
        result.account.holder,
        result.account.payto,
        via,
      ],
    );
  });
}

const linkView = (l: LinkRow | null) =>
  l
    ? { linked: true, iban: l.bank_iban, holder: l.bank_holder, linkedAt: l.created_at, expiresAt: l.bank_token_expires_at, via: l.linked_via }
    : { linked: false };

// ------------------------------------------------------------ link lock
/**
 * The bank link is the wallet's money pipe, so once a wallet has ever been linked,
 * changing or removing it needs a fresh code sent to the account e-mail — and by
 * SMS too when the account has a phone number. A stolen session alone can't
 * redirect the money.
 */
async function everLinked(userId: string) {
  return Boolean(await one(`SELECT 1 FROM ${S}.bank_accounts WHERE user_id = $1 LIMIT 1`, [userId]));
}

bankRouter.post(
  '/link/change-code',
  requireAuth,
  codeLimiter,
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    const u = await one<any>(`SELECT email, phone_number, language FROM ${S}.users WHERE id = $1`, [userId]);
    const code = numericCode(6);
    await pool.query(`UPDATE ${S}.profile_update_verifications SET verified = true WHERE user_id = $1 AND update_type = 'bank_link' AND verified = false`, [userId]);
    await pool.query(
      `INSERT INTO ${S}.profile_update_verifications (user_id, verification_code, update_type, expires_at, verified, attempts)
       VALUES ($1, $2, 'bank_link', now() + interval '15 minutes', false, 0)`,
      [userId, codeHash('bank-link', String(userId), code)],
    );
    await sendMail(codeMail(u.email, 'security', code, u.language === 'en' ? 'en' : 'ar'));
    const sms = Boolean(u.phone_number && smsEnabled());
    if (sms) await sendSmsCode(u.phone_number, u.language === 'en' ? 'en' : 'ar');
    res.json({ success: true, data: { sms, email: u.email.replace(/^(.).*(@.*)$/, '$1•••$2') } });
  }),
);

const changeProof = { changeCode: otpCode.optional(), smsCode: otpCode.optional() };

async function assertChangeAllowed(userId: string, b: { changeCode?: string; smsCode?: string }) {
  if (!(await everLinked(userId))) return;
  if (!b.changeCode) throw new AppError(403, 'LINK_LOCKED', 'Changing the linked bank needs the code we e-mail you');
  const v = await one<any>(
    `SELECT id, verification_code, attempts, expires_at FROM ${S}.profile_update_verifications
      WHERE user_id = $1 AND update_type = 'bank_link' AND verified = false ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  if (!v || v.attempts >= 5 || new Date(v.expires_at) < new Date() || v.verification_code !== codeHash('bank-link', String(userId), b.changeCode)) {
    if (v) await pool.query(`UPDATE ${S}.profile_update_verifications SET attempts = attempts + 1 WHERE id = $1`, [v.id]);
    throw badRequest('INVALID_CODE', 'Invalid or expired code');
  }
  const u = await one<any>(`SELECT phone_number FROM ${S}.users WHERE id = $1`, [userId]);
  if (u?.phone_number && smsEnabled()) {
    if (!b.smsCode || !(await checkSmsCode(u.phone_number, b.smsCode))) throw badRequest('INVALID_SMS_CODE', 'The SMS code is not right');
  }
  await pool.query(`UPDATE ${S}.profile_update_verifications SET verified = true WHERE id = $1`, [v.id]);
}

bankRouter.get(
  '/link',
  requireAuth,
  ah(async (req, res) => {
    const l = await activeLink(req.auth!.userId);
    res.json({ success: true, data: { ...linkView(l), bankUrl: env.BANK_PUBLIC_URL ?? env.BANK_API_URL } });
  }),
);

bankRouter.post(
  '/link',
  requireAuth,
  authLimiter,
  validate({ body: z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/, 'Link code looks like ABCD-EFGH'), ...changeProof }).strict() }),
  ah(async (req, res) => {
    await assertChangeAllowed(req.auth!.userId, req.body);
    const code = req.body.code.includes('-') ? req.body.code : `${req.body.code.slice(0, 4)}-${req.body.code.slice(4)}`;
    const w = await walletOfUser(req.auth!.userId);
    const result = await bank.redeemLinkCode(code, w.wallet_id);
    await storeLink(req.auth!.userId, 'code', result);
    await audit({ userId: req.auth!.userId, action: 'bank.linked', details: { via: 'code', iban: result.account.iban } }, req);
    res.status(201).json({ success: true, data: linkView(await activeLink(req.auth!.userId)) });
  }),
);

/** Credentials are forwarded once to the bank over TLS and never stored here. */
bankRouter.post(
  '/link/credentials',
  requireAuth,
  authLimiter,
  validate({ body: z.object({ login: z.string().trim().min(3).max(254), password: z.string().min(1).max(256), totp: totpCode.optional(), ...changeProof }).strict() }),
  ah(async (req, res) => {
    await assertChangeAllowed(req.auth!.userId, req.body);
    const w = await walletOfUser(req.auth!.userId);
    const result = await bank.linkWithCredentials(req.body.login, req.body.password, req.body.totp, w.wallet_id);
    await storeLink(req.auth!.userId, 'credentials', result);
    await audit({ userId: req.auth!.userId, action: 'bank.linked', details: { via: 'credentials', iban: result.account.iban } }, req);
    res.status(201).json({ success: true, data: linkView(await activeLink(req.auth!.userId)) });
  }),
);

bankRouter.delete(
  '/link',
  requireAuth,
  validate({ body: z.object(changeProof).strict().optional() }),
  ah(async (req, res) => {
    await assertChangeAllowed(req.auth!.userId, req.body ?? {});
    const l = await activeLink(req.auth!.userId);
    if (l) {
      await bank.revokeLink(linkToken(l)).catch(() => undefined);
      await pool.query(`UPDATE ${S}.bank_accounts SET status = 'inactive', bank_token_enc = NULL WHERE user_id = $1 AND status = 'active'`, [req.auth!.userId]);
      await audit({ userId: req.auth!.userId, action: 'bank.unlinked' }, req);
    }
    res.json({ success: true });
  }),
);

bankRouter.get(
  '/link/balance',
  requireAuth,
  ah(async (req, res) => {
    const l = await requireLink(req.auth!.userId);
    try {
      const acc = await bank.linkedAccount(linkToken(l));
      res.json({ success: true, data: { balance: acc.balance, currency: acc.currency, iban: acc.iban, holder: acc.holder, locked: acc.locked } });
    } catch (e) {
      await onLinkError(req.auth!.userId, e);
      throw e;
    }
  }),
);

// ======================================================= finalisation (idempotent)
/** Credits the wallet for a bank -> wallet operation exactly once (status transition guards it). */
export async function finalizeIncoming(opId: string): Promise<boolean> {
  return tx(async (c) => {
    const op = await one<any>(
      `UPDATE ${S}.bank_operations SET status = 'completed', completed_at = now(), error = NULL
        WHERE id = $1 AND status = 'pending' AND kind IN ('link_withdraw','qr_withdraw') RETURNING *`,
      [opId],
      c,
    );
    if (!op) return false;
    const w = await one<any>(`SELECT id, wallet_id, user_id FROM ${S}.wallets WHERE id = $1 FOR UPDATE`, [op.wallet_ref], c);
    const balance = await credit(c, w.id, op.amount);
    await c.query(
      `INSERT INTO ${S}.reserves (wallet_id, reserve_pub, reserve_priv, amount, status, source, bank_reference) VALUES ($1, $2, $3, $4, 'active', $5, $6)`,
      [w.id, op.reserve_pub, op.reserve_priv_enc, op.amount, op.kind, op.request_uid ?? op.bank_operation_id],
    );
    await writeLine(c, {
      userId: w.user_id,
      walletId: w.wallet_id,
      type: 'withdraw',
      amount: op.amount,
      description: op.kind === 'qr_withdraw' ? 'Top-up from TalerBank (QR)' : 'Top-up from TalerBank',
      from: op.bank_iban ?? 'TalerBank',
      to: w.wallet_id,
      counterparty: 'TalerBank',
      reference: op.id,
      metadata: { bankOperation: op.bank_operation_id ?? op.request_uid, reservePub: op.reserve_pub },
      balanceAfter: balance,
    });
    await notify(c, w.user_id, 'bank_topup', 'Wallet topped up', `${op.amount} ${env.CURRENCY} arrived from TalerBank`, {
      operation: op.id,
      ar: { title: 'انشحنت محفظتك', body: `وصل ${op.amount} ${env.CURRENCY} من TalerBank` },
    });
    return true;
  });
}

async function finalizeDeposit(opId: string) {
  await tx(async (c) => {
    const op = await one<any>(
      `UPDATE ${S}.bank_operations SET status = 'completed', completed_at = now(), error = NULL WHERE id = $1 AND status = 'pending' AND kind = 'deposit' RETURNING *`,
      [opId],
      c,
    );
    if (!op) return;
    await c.query(`UPDATE ${S}.transactions SET status = 'completed' WHERE reference = $1 AND transaction_type = 'deposit'`, [op.id]);
    await notify(c, op.user_id, 'bank_deposit', 'Sent to your bank', `${op.amount} ${env.CURRENCY} arrived in your TalerBank account`, {
      ar: { title: 'وصلت مصاريك للبنك', body: `وصل ${op.amount} ${env.CURRENCY} لحسابك في TalerBank` },
    });
  });
}

async function refundDeposit(opId: string, reason: string) {
  await tx(async (c) => {
    const op = await one<any>(
      `UPDATE ${S}.bank_operations SET status = 'failed', error = $2 WHERE id = $1 AND status = 'pending' AND kind = 'deposit' RETURNING *`,
      [opId, reason.slice(0, 200)],
      c,
    );
    if (!op) return;
    const w = await one<any>(`SELECT id, wallet_id, user_id FROM ${S}.wallets WHERE id = $1 FOR UPDATE`, [op.wallet_ref], c);
    const balance = await credit(c, w.id, op.amount);
    await c.query(`UPDATE ${S}.transactions SET status = 'failed' WHERE reference = $1 AND transaction_type = 'deposit'`, [op.id]);
    await writeLine(c, {
      userId: w.user_id,
      walletId: w.wallet_id,
      type: 'deposit_refund',
      amount: op.amount,
      description: 'Refund — bank transfer failed',
      reference: op.id,
      balanceAfter: balance,
    });
    await notify(c, w.user_id, 'bank_deposit_failed', 'Bank transfer failed', `${op.amount} ${env.CURRENCY} returned to your wallet`, {
      ar: { title: 'ما زبط التحويل للبنك', body: `رجع ${op.amount} ${env.CURRENCY} لمحفظتك` },
    });
  });
}

// ========================================================= bank -> wallet
bankRouter.post(
  '/withdraw',
  requireAuth,
  moneyLimiter,
  validate({ body: z.object({ amount: amountSchema }).strict() }),
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    const key = req.headers['idempotency-key'] ? idempotencyKey.parse(req.headers['idempotency-key']) : undefined;
    const out = await idempotent(`bank-withdraw:${userId}`, key, req.body, async () => {
      const { amount } = req.body;
      assertMaxTransfer(amount);
      const l = await requireLink(userId);
      const w = await walletOfUser(userId);
      const { reservePub, reservePriv } = newReserveKeypair();
      const requestUid = `stw_${randomToken(18)}`;
      const op = await one<any>(
        `INSERT INTO ${S}.bank_operations (user_id, wallet_ref, kind, status, amount, request_uid, reserve_pub, reserve_priv_enc, bank_iban)
         VALUES ($1, $2, 'link_withdraw', 'pending', $3, $4, $5, $6, $7) RETURNING id`,
        [userId, w.id, amount, requestUid, reservePub, encrypt(reservePriv, 'reserve'), l.bank_iban],
      );
      try {
        await bank.linkWithdraw(linkToken(l), amount, reservePub, requestUid);
      } catch (e) {
        if (e instanceof BankRejected) {
          await pool.query(`UPDATE ${S}.bank_operations SET status = 'failed', error = $2 WHERE id = $1`, [op.id, e.code]);
          await onLinkError(userId, e);
          throw e;
        }
        if (e instanceof BankUnreachable) {
          return { status: 202, body: { success: true, data: { status: 'processing', operationId: op.id } } };
        }
        throw e;
      }
      await finalizeIncoming(op.id);
      await audit({ userId, action: 'bank.withdraw', entityType: 'bank_operation', entityId: op.id, details: { amount } }, req);
      const balance = (await walletOfUser(userId)).balance;
      return { status: 201, body: { success: true, data: { status: 'completed', operationId: op.id, amount, balance } } };
    });
    res.status(out.status).json(out.body);
  }),
);

// ========================================================= wallet -> bank
bankRouter.post(
  '/deposit',
  requireAuth,
  moneyLimiter,
  validate({ body: z.object({ amount: amountSchema, totp: totpCode.optional() }).strict() }),
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    const key = req.headers['idempotency-key'] ? idempotencyKey.parse(req.headers['idempotency-key']) : undefined;
    const out = await idempotent(`bank-deposit:${userId}`, key, req.body, async () => {
      const { amount, totp } = req.body;
      assertMaxTransfer(amount);
      await requireSecondFactor(userId, totp);
      const l = await requireLink(userId);
      const requestUid = `std_${randomToken(18)}`;
      const op = await tx(async (c) => {
        const w = await walletOfUser(userId, c, true);
        await assertDailyLimit(c, w.wallet_id, amount);
        const balance = await debit(c, w.id, amount);
        const o = await one<any>(
          `INSERT INTO ${S}.bank_operations (user_id, wallet_ref, kind, status, amount, request_uid, bank_iban)
           VALUES ($1, $2, 'deposit', 'pending', $3, $4, $5) RETURNING id`,
          [userId, w.id, amount, requestUid, l.bank_iban],
          c,
        );
        await writeLine(c, {
          userId,
          walletId: w.wallet_id,
          type: 'deposit',
          amount: `-${amount}`,
          description: 'Sent to TalerBank',
          from: w.wallet_id,
          to: l.bank_iban,
          counterparty: l.bank_holder,
          status: 'pending',
          reference: o.id,
          balanceAfter: balance,
        });
        return { id: o.id as string, walletId: w.wallet_id, balance };
      });
      try {
        await bank.wireTransfer(requestUid, amount, l.bank_payto, `S-Taler ${op.walletId}`);
      } catch (e) {
        if (e instanceof BankRejected) {
          await refundDeposit(op.id, e.code);
          throw e;
        }
        if (e instanceof BankUnreachable) {
          return { status: 202, body: { success: true, data: { status: 'processing', operationId: op.id, balance: op.balance } } };
        }
        throw e;
      }
      await finalizeDeposit(op.id);
      await audit({ userId, action: 'bank.deposit', entityType: 'bank_operation', entityId: op.id, details: { amount } }, req);
      return { status: 201, body: { success: true, data: { status: 'completed', operationId: op.id, amount, balance: op.balance } } };
    });
    res.status(out.status).json(out.body);
  }),
);

// ============================================== QR withdrawals (bank app QR)
const OP_ID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
export function parseWithdrawUri(raw: string): string {
  const s = raw.trim();
  if (!/^(taler:\/\/withdraw\/|https?:\/\/|[0-9a-f]{8}-)/i.test(s)) throw badRequest('INVALID_QR', 'This is not a TalerBank withdrawal QR code');
  const m = OP_ID.exec(s.split('?')[0]!);
  if (!m) throw badRequest('INVALID_QR', 'This is not a TalerBank withdrawal QR code');
  return m[1]!.toLowerCase();
}

const uriBody = z.object({ uri: z.string().trim().min(36).max(512) }).strict();

bankRouter.post(
  '/qr/inspect',
  requireAuth,
  validate({ body: uriBody }),
  ah(async (req, res) => {
    const opId = parseWithdrawUri(req.body.uri);
    const op = await bank.getOperation(opId);
    res.json({
      success: true,
      data: { operationId: opId, status: op.status, amount: op.amount_value, currency: op.currency, holder: op.account_holder, expiresAt: op.expires_at },
    });
  }),
);

bankRouter.post(
  '/qr/accept',
  requireAuth,
  moneyLimiter,
  validate({ body: uriBody }),
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    const opId = parseWithdrawUri(req.body.uri);
    const existing = await one<any>(`SELECT id, user_id, status FROM ${S}.bank_operations WHERE bank_operation_id = $1`, [opId]);
    if (existing) {
      if (String(existing.user_id) !== String(userId)) throw conflict('ALREADY_CLAIMED', 'This QR code was already scanned by another wallet');
      return res.json({ success: true, data: { operationId: opId, status: existing.status === 'completed' ? 'confirmed' : 'selected' } });
    }
    const op = await bank.getOperation(opId);
    if (op.status !== 'pending') throw conflict('QR_NOT_AVAILABLE', op.status === 'aborted' ? 'This withdrawal was cancelled or expired' : 'This QR code was already used');
    if (op.currency !== env.CURRENCY) throw badRequest('CURRENCY_MISMATCH', 'Unsupported currency');
    assertMaxTransfer(op.amount_value);
    const w = await walletOfUser(userId);
    const { reservePub, reservePriv } = newReserveKeypair();
    const local = await one<any>(
      `INSERT INTO ${S}.bank_operations (user_id, wallet_ref, kind, status, amount, bank_operation_id, reserve_pub, reserve_priv_enc)
       VALUES ($1, $2, 'qr_withdraw', 'pending', $3, $4, $5, $6) RETURNING id`,
      [userId, w.id, op.amount_value, opId, reservePub, encrypt(reservePriv, 'reserve')],
    );
    try {
      await bank.selectOperation(opId, reservePub, w.wallet_id);
    } catch (e) {
      if (e instanceof BankRejected) {
        await pool.query(`UPDATE ${S}.bank_operations SET status = 'failed', error = $2 WHERE id = $1`, [local.id, e.code]);
      }
      throw e;
    }
    await audit({ userId, action: 'bank.qr_selected', entityType: 'bank_operation', entityId: local.id, details: { amount: op.amount_value } }, req);
    res.status(201).json({
      success: true,
      data: { operationId: opId, status: 'selected', amount: op.amount_value, confirmUrl: op.confirm_transfer_url ?? null },
    });
  }),
);

/** Polled by the app while the customer confirms in the bank; credits the wallet once confirmed. */
bankRouter.get(
  '/qr/:opId',
  requireAuth,
  validate({ params: z.object({ opId: z.string().uuid() }).strict() }),
  ah(async (req, res) => {
    const local = await one<any>(`SELECT * FROM ${S}.bank_operations WHERE bank_operation_id = $1 AND user_id = $2`, [req.params.opId, req.auth!.userId]);
    if (!local) throw notFound('Unknown withdrawal');
    if (local.status === 'pending') await syncQr(local);
    const fresh = await one<any>(`SELECT status, amount FROM ${S}.bank_operations WHERE id = $1`, [local.id]);
    const balance = (await walletOfUser(req.auth!.userId)).balance;
    res.json({ success: true, data: { status: fresh.status, amount: fresh.amount, balance } });
  }),
);

async function syncQr(local: any) {
  try {
    const op = await bank.getOperation(local.bank_operation_id);
    if (op.status === 'confirmed' && op.transfer_done) {
      if (op.reserve_pub !== local.reserve_pub || cmp(op.amount_value, local.amount) !== 0) {
        logger.error({ op: local.id }, 'bank operation does not match the wallet selection');
        await pool.query(`UPDATE ${S}.bank_operations SET status = 'failed', error = 'MISMATCH' WHERE id = $1`, [local.id]);
        return;
      }
      await finalizeIncoming(local.id);
    } else if (op.status === 'aborted') {
      await pool.query(`UPDATE ${S}.bank_operations SET status = 'aborted' WHERE id = $1 AND status = 'pending'`, [local.id]);
    }
  } catch (e) {
    if (e instanceof BankRejected && e.status === 404) {
      await pool.query(`UPDATE ${S}.bank_operations SET status = 'aborted', error = 'NOT_FOUND' WHERE id = $1 AND status = 'pending'`, [local.id]);
    }
  }
}

bankRouter.get(
  '/operations',
  requireAuth,
  ah(async (req, res) => {
    const r = await pool.query(
      `SELECT id, kind, status, amount, error, created_at, completed_at FROM ${S}.bank_operations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [req.auth!.userId],
    );
    res.json({ success: true, data: { operations: r.rows } });
  }),
);

// ================================================================ webhook
/** Signed push from TalerBank (HMAC-SHA256, 5-minute replay window, de-duplicated by event id). */
export function verifyWebhookSignature(req: Request): boolean {
  if (!env.WEBHOOK_SECRET || !req.rawBody) return false;
  const header = String(req.headers['x-talerbank-signature'] ?? '');
  const m = /^t=(\d{10}),v1=([0-9a-f]{64})$/.exec(header);
  if (!m) return false;
  if (Math.abs(Date.now() / 1000 - Number(m[1])) > 300) return false;
  const expected = crypto.createHmac('sha256', env.WEBHOOK_SECRET).update(`${m[1]}.${req.rawBody.toString('utf8')}`).digest('hex');
  return safeEqual(expected, m[2]!);
}

export const webhookRouter = Router();
webhookRouter.post(
  '/',
  ah(async (req, res) => {
    if (!verifyWebhookSignature(req)) throw forbidden('Invalid signature', 'BAD_SIGNATURE');
    const body = z
      .object({
        event: z.string().max(64),
        id: z.string().uuid(),
        created_at: z.string().max(40),
        data: z.object({ operation_id: z.string().uuid().optional() }).passthrough(),
      })
      .parse(req.body);
    const fresh = await pool.query(`INSERT INTO ${S}.webhook_events (id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id`, [body.id]);
    if (fresh.rowCount === 0) return res.json({ success: true, duplicate: true });
    if (body.data.operation_id && (body.event === 'withdrawal.confirmed' || body.event === 'withdrawal.aborted')) {
      const local = await one<any>(`SELECT * FROM ${S}.bank_operations WHERE bank_operation_id = $1 AND status = 'pending'`, [body.data.operation_id]);
      // Never trust the push payload for amounts — re-read the operation from the bank.
      if (local) await syncQr(local);
    }
    res.json({ success: true });
  }),
);

// ============================================================ reconciler
/** Settles operations whose outcome was unknown (network failure, crash, restart). */
export async function reconcilePending(): Promise<{ checked: number }> {
  const r = await pool.query(
    `SELECT * FROM ${S}.bank_operations WHERE status = 'pending' AND updated_at < now() - interval '20 seconds' ORDER BY created_at ASC LIMIT 50`,
  );
  for (const op of r.rows) {
    try {
      await pool.query(`UPDATE ${S}.bank_operations SET attempts = attempts + 1 WHERE id = $1`, [op.id]);
      if (op.kind === 'qr_withdraw') {
        await syncQr(op);
      } else if (op.kind === 'link_withdraw') {
        try {
          await bank.reserveStatus(op.reserve_pub);
          await finalizeIncoming(op.id);
        } catch (e) {
          if (e instanceof BankRejected && e.status === 404 && Date.now() - new Date(op.created_at).getTime() > 10 * 60_000) {
            await pool.query(`UPDATE ${S}.bank_operations SET status = 'failed', error = 'NOT_EXECUTED' WHERE id = $1 AND status = 'pending'`, [op.id]);
          }
        }
      } else if (op.kind === 'deposit') {
        try {
          await bank.wireTransferStatus(op.request_uid);
          await finalizeDeposit(op.id);
        } catch (e) {
          if (e instanceof BankRejected && e.status === 404) {
            // Never reached the bank: the transfer is idempotent by request_uid, so simply retry it.
            const l = await one<any>(`SELECT bank_payto FROM ${S}.bank_accounts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [op.user_id]);
            if (!l?.bank_payto || op.attempts >= 6) {
              await refundDeposit(op.id, 'NOT_EXECUTED');
              continue;
            }
            try {
              await bank.wireTransfer(op.request_uid, op.amount, l.bank_payto, 'S-Taler deposit');
              await finalizeDeposit(op.id);
            } catch (e2) {
              if (e2 instanceof BankRejected) await refundDeposit(op.id, e2.code);
            }
          }
        }
      }
    } catch (err) {
      logger.warn({ err, op: op.id }, 'reconcile step failed');
    }
  }
  return { checked: r.rowCount ?? 0 };
}


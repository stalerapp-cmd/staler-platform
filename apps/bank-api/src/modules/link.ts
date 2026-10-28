import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { one, pool, S, tx } from '../lib/db.js';
import { hmac, randomToken, readableCode, sha256 } from '../lib/crypto.js';
import { AppError, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { amountSchema, cmp } from '../lib/money.js';
import { totpCode, uuid, validate } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { verifyPassword } from '../lib/passwords.js';
import { requireAuth, requireExchange, requireLink } from '../middleware/auth.js';
import { authLimiter, moneyLimiter } from '../middleware/security.js';
import { assertDailyLimit, assertMaxTransfer, exchangeAccount, move, notify } from './ledger.js';
import { checkSecondFactor, requireSecondFactor } from './mfa.js';
import { ownAccount } from './banking.js';
import { recordFailure } from './auth.js';
import { reservePub } from './withdrawals.js';

const LINK_TTL_DAYS = 90;
const LINK_SCOPES = ['read', 'withdraw'];
const clientName = z.string().trim().min(2).max(40).regex(/^[\p{L}\p{N} ._-]+$/u);
const walletRef = z.string().trim().max(64).regex(/^[A-Za-z0-9_.:-]*$/).optional();

async function issueLinkToken(userId: string, accountId: string, name: string, ref?: string) {
  const token = `tbl_${randomToken(32)}`;
  const row = await one<any>(
    `INSERT INTO ${S}.api_tokens (user_id, account_id, token_hash, scopes, client_name, description, per_operation_limit, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '${LINK_TTL_DAYS} days') RETURNING id, expires_at`,
    [userId, accountId, sha256(token), LINK_SCOPES, name, ref ? `wallet ${ref}` : null, env.MAX_TRANSFER],
  );
  const acc = await one<any>(
    `SELECT a.iban, a.currency, a.payto_uri, u.full_name FROM ${S}.bank_accounts a JOIN ${S}.users u ON u.id = a.user_id WHERE a.id = $1`,
    [accountId],
  );
  await notify(undefined, userId, 'app_linked', 'New app linked', `${name} can now move money from your account to your wallet.`);
  return {
    token,
    tokenId: row.id,
    expiresAt: row.expires_at,
    scopes: LINK_SCOPES,
    account: { iban: acc.iban, holder: acc.full_name, currency: acc.currency, payto: acc.payto_uri },
  };
}

// ============================================== customer-side management
export const linkCustomerRouter = Router();
linkCustomerRouter.use(requireAuth);

/** A short code the customer types into S-Taler — their bank password never leaves the bank. */
linkCustomerRouter.post(
  '/link-codes',
  moneyLimiter,
  validate({ body: z.object({ accountId: uuid, totp: totpCode.optional() }).strict() }),
  ah(async (req, res) => {
    const userId = req.auth!.userId;
    const acc = await ownAccount(userId, req.body.accountId);
    if (acc.is_locked) throw forbidden('Account is frozen', 'ACCOUNT_LOCKED');
    await requireSecondFactor(userId, req.body.totp);
    const code = `${readableCode(4)}-${readableCode(4)}`;
    await pool.query(`UPDATE ${S}.link_codes SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [userId]);
    const row = await one(
      `INSERT INTO ${S}.link_codes (user_id, account_id, code_hash, expires_at) VALUES ($1, $2, $3, now() + interval '10 minutes')
       RETURNING expires_at`,
      [userId, acc.id, hmac(`link|${code}`)],
    );
    await audit({ userId, action: 'link.code_created', entityType: 'account', entityId: acc.id }, req);
    res.status(201).json({ success: true, data: { code, expiresAt: row.expires_at } });
  }),
);

linkCustomerRouter.get(
  '/linked-apps',
  ah(async (req, res) => {
    const r = await pool.query(
      `SELECT t.id, t.client_name, t.description, t.scopes, t.created_at, t.expires_at, t.last_used_at, a.iban
         FROM ${S}.api_tokens t JOIN ${S}.bank_accounts a ON a.id = t.account_id
        WHERE t.user_id = $1 AND t.revoked_at IS NULL AND t.expires_at > now() ORDER BY t.created_at DESC`,
      [req.auth!.userId],
    );
    res.json({ success: true, data: { apps: r.rows } });
  }),
);

linkCustomerRouter.delete(
  '/linked-apps/:id',
  validate({ params: z.object({ id: uuid }).strict() }),
  ah(async (req, res) => {
    const r = await pool.query(`UPDATE ${S}.api_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, [
      req.params.id,
      req.auth!.userId,
    ]);
    if (r.rowCount === 0) throw notFound('Linked app not found');
    await audit({ userId: req.auth!.userId, action: 'link.revoked', entityType: 'api_token', entityId: req.params.id }, req);
    res.json({ success: true });
  }),
);

// ============================================ exchange-side (S-Taler server)
export const linkExchangeRouter = Router();

linkExchangeRouter.post(
  '/redeem-code',
  requireExchange,
  authLimiter,
  validate({ body: z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/), clientName, walletRef }).strict() }),
  ah(async (req, res) => {
    const row = await tx(async (c) => {
      const lc = await one<any>(
        `SELECT * FROM ${S}.link_codes WHERE code_hash = $1 FOR UPDATE`,
        [hmac(`link|${req.body.code}`)],
        c,
      );
      if (!lc || lc.used_at || new Date(lc.expires_at) < new Date()) throw new AppError(400, 'INVALID_LINK_CODE', 'Link code is invalid or expired');
      await c.query(`UPDATE ${S}.link_codes SET used_at = now() WHERE id = $1`, [lc.id]);
      return lc;
    });
    const out = await issueLinkToken(row.user_id, row.account_id, req.body.clientName, req.body.walletRef);
    await audit({ userId: row.user_id, action: 'link.created', details: { via: 'code', client: req.body.clientName } }, req);
    res.status(201).json({ success: true, data: out });
  }),
);

/** Alternative: the customer types bank credentials into S-Taler; they are checked here and never stored by S-Taler. */
linkExchangeRouter.post(
  '/credentials',
  requireExchange,
  authLimiter,
  validate({
    body: z
      .object({
        login: z.string().trim().toLowerCase().min(3).max(254),
        password: z.string().min(1).max(256),
        totp: totpCode.optional(),
        clientName,
        walletRef,
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const u = await one<any>(
      `SELECT id, role, status, password_hash, locked_until FROM ${S}.users WHERE lower(email) = $1 OR username = $1 LIMIT 1`,
      [req.body.login],
    );
    if (u?.locked_until && new Date(u.locked_until) > new Date()) {
      throw new AppError(423, 'ACCOUNT_TEMPORARILY_LOCKED', 'Bank account temporarily locked after failed attempts');
    }
    const ok = await verifyPassword(req.body.password, u?.password_hash);
    if (!u || !ok || u.role !== 'user') {
      if (u) await recordFailure(u.id);
      throw unauthorized('Bank credentials are incorrect', 'INVALID_CREDENTIALS');
    }
    if (u.status !== 'active') throw forbidden('Bank account is suspended', 'ACCOUNT_SUSPENDED');
    if (!(await checkSecondFactor(u.id, req.body.totp))) {
      throw new AppError(401, req.body.totp ? 'MFA_INVALID' : 'MFA_REQUIRED', 'Bank authenticator code required');
    }
    await pool.query(`UPDATE ${S}.users SET failed_login_count = 0, locked_until = NULL WHERE id = $1`, [u.id]);
    const acc = await one<any>(
      `SELECT id FROM ${S}.bank_accounts WHERE user_id = $1 AND is_taler_exchange = false ORDER BY is_primary DESC, created_at ASC LIMIT 1`,
      [u.id],
    );
    if (!acc) throw notFound('No bank account found');
    const out = await issueLinkToken(u.id, acc.id, req.body.clientName, req.body.walletRef);
    await audit({ userId: u.id, action: 'link.created', details: { via: 'credentials', client: req.body.clientName } }, req);
    res.status(201).json({ success: true, data: out });
  }),
);

// ================================================= link-token operations
linkExchangeRouter.get(
  '/account',
  requireLink('read'),
  ah(async (req, res) => {
    const acc = await one<any>(
      `SELECT a.iban, a.currency, a.balance, a.is_locked, a.payto_uri, u.full_name
         FROM ${S}.bank_accounts a JOIN ${S}.users u ON u.id = a.user_id WHERE a.id = $1`,
      [req.link!.accountId],
    );
    res.json({ success: true, data: { iban: acc.iban, holder: acc.full_name, currency: acc.currency, balance: acc.balance, locked: acc.is_locked, payto: acc.payto_uri } });
  }),
);

/**
 * Bank -> wallet in one call: debits the customer, credits the exchange
 * account with the wallet's reserve key as subject. Idempotent by request_uid.
 */
linkExchangeRouter.post(
  '/withdraw',
  requireLink('withdraw'),
  moneyLimiter,
  validate({
    body: z.object({ amount: amountSchema, reserve_pub: reservePub, request_uid: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }).strict(),
  }),
  ah(async (req, res) => {
    const link = req.link!;
    const { amount, reserve_pub, request_uid } = req.body;
    const existing = await one<any>(`SELECT id, amount, subject, created_at FROM ${S}.transactions WHERE request_uid = $1`, [request_uid]);
    if (existing) {
      if (cmp(existing.amount, amount) !== 0 || existing.subject !== reserve_pub) {
        throw conflict('REQUEST_UID_REUSED', 'request_uid already used for a different operation');
      }
      return res.json({ success: true, data: { transactionId: existing.id, status: 'completed', replay: true } });
    }
    assertMaxTransfer(amount);
    if (link.perOperationLimit && cmp(amount, link.perOperationLimit) > 0) {
      throw new AppError(400, 'LIMIT_EXCEEDED', `This app may move at most ${link.perOperationLimit} per operation`);
    }
    const t = await tx(async (c) => {
      await assertDailyLimit(c, link.userId, amount);
      const ex = await exchangeAccount(c);
      const moved = await move(c, {
        fromAccountId: link.accountId,
        toAccountId: ex.id,
        amount,
        type: 'taler_withdraw',
        subject: reserve_pub,
        initiatedBy: link.userId,
        requestUid: request_uid,
        metadata: { via: 'wallet-link', tokenId: link.tokenId },
      });
      await c.query(
        `INSERT INTO ${S}.reserves (reserve_pub, account_id, amount, currency, status, transaction_id, source)
         VALUES ($1, $2, $3, $4, 'open', $5, 'wallet_link')`,
        [reserve_pub, link.accountId, amount, env.CURRENCY, moved.id],
      );
      await notify(c, link.userId, 'withdrawal_confirmed', 'Sent to wallet', `${amount} ${env.CURRENCY} moved to your S-Taler wallet`);
      return moved;
    });
    await audit({ userId: link.userId, action: 'link.withdraw', entityType: 'transaction', entityId: t.id, details: { amount } }, req);
    res.status(201).json({ success: true, data: { transactionId: t.id, status: 'completed', balanceAfter: t.from_balance_after } });
  }),
);

linkExchangeRouter.get(
  '/operations/:requestUid',
  requireLink('read'),
  validate({ params: z.object({ requestUid: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }).strict() }),
  ah(async (req, res) => {
    const t = await one<any>(
      `SELECT id, amount, status, created_at FROM ${S}.transactions WHERE request_uid = $1 AND from_account_id = $2`,
      [req.params.requestUid, req.link!.accountId],
    );
    if (!t) return res.status(404).json({ success: false, error: { code: 'OPERATION_NOT_FOUND', message: 'No such operation' } });
    res.json({ success: true, data: { transactionId: t.id, amount: t.amount, status: t.status, createdAt: t.created_at } });
  }),
);

linkExchangeRouter.delete(
  '/token',
  requireLink('read'),
  ah(async (req, res) => {
    await pool.query(`UPDATE ${S}.api_tokens SET revoked_at = now() WHERE id = $1`, [req.link!.tokenId]);
    await audit({ userId: req.link!.userId, action: 'link.revoked_by_app' }, req);
    res.json({ success: true });
  }),
);

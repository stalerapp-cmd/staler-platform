import type pg from 'pg';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { one, S } from '../lib/db.js';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { cmp, toCents } from '../lib/money.js';

export interface WalletRow {
  id: string;
  user_id: string;
  wallet_id: string;
  balance: string;
  currency: string;
  is_frozen: boolean;
}

/** Generates an unguessable public wallet id (old ones were 8 weak random chars). */
export function newWalletId(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 12; i++) s += alphabet[crypto.randomInt(0, alphabet.length)];
  return `wallet_${s}`;
}

export async function walletOfUser(userId: string, c?: pg.PoolClient, lock = false): Promise<WalletRow> {
  const w = await one<WalletRow>(
    `SELECT id, user_id, wallet_id, balance, currency, is_frozen FROM ${S}.wallets
      WHERE user_id = $1 ORDER BY created_at ASC NULLS LAST, id LIMIT 1 ${lock ? 'FOR UPDATE' : ''}`,
    [userId],
    c,
  );
  if (!w) throw notFound('Wallet not found', 'WALLET_NOT_FOUND');
  return w;
}

export async function createWallet(c: pg.PoolClient, userId: string): Promise<WalletRow> {
  const w = await one<WalletRow>(
    `INSERT INTO ${S}.wallets (user_id, wallet_id, balance, currency) VALUES ($1, $2, 0, $3)
     RETURNING id, user_id, wallet_id, balance, currency, is_frozen`,
    [userId, newWalletId(), env.CURRENCY],
    c,
  );
  return w!;
}

/** Locks wallets in a stable order to make opposite concurrent transfers deadlock-free. */
async function lockWallets(c: pg.PoolClient, ids: string[]) {
  const r = await c.query<WalletRow>(
    `SELECT id, user_id, wallet_id, balance, currency, is_frozen FROM ${S}.wallets WHERE id = ANY($1) ORDER BY id FOR UPDATE`,
    [Array.from(new Set(ids))],
  );
  return new Map(r.rows.map((w) => [String(w.id), w]));
}

export interface LedgerLine {
  userId: string;
  walletId: string; // public wallet id
  type: string;
  amount: string; // signed decimal
  description: string;
  from?: string | null;
  to?: string | null;
  counterparty?: string | null;
  status?: string;
  reference?: string;
  metadata?: Record<string, unknown>;
  balanceAfter?: string | null;
}

export async function writeLine(c: pg.PoolClient, l: LedgerLine) {
  return one<{ id: string; created_at: string }>(
    `INSERT INTO ${S}.transactions (user_id, wallet_id, transaction_type, amount, currency, status, description, from_account,
                                    to_account, reference, metadata, counterparty_name, balance_after)
     VALUES ($1, $2, $3, $4::numeric, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id, created_at`,
    [
      l.userId,
      l.walletId,
      l.type,
      l.amount,
      env.CURRENCY,
      l.status ?? 'completed',
      l.description.slice(0, 200),
      l.from ?? null,
      l.to ?? null,
      l.reference ?? crypto.randomUUID(),
      JSON.stringify(l.metadata ?? {}),
      l.counterparty ?? null,
      l.balanceAfter ?? null,
    ],
    c,
  );
}

/** Debits a (locked or unlocked) wallet; the WHERE clause is the last line of defence against overdraft. */
export async function debit(c: pg.PoolClient, walletDbId: string, amount: string, allowFrozen = false): Promise<string> {
  const r = await c.query<{ balance: string }>(
    `UPDATE ${S}.wallets SET balance = balance - $2::numeric
      WHERE id = $1 AND balance >= $2::numeric ${allowFrozen ? '' : 'AND NOT is_frozen'} RETURNING balance`,
    [walletDbId, amount],
  );
  if (r.rowCount === 0) {
    const w = await one<{ is_frozen: boolean }>(`SELECT is_frozen FROM ${S}.wallets WHERE id = $1`, [walletDbId], c);
    if (w?.is_frozen && !allowFrozen) throw forbidden('This wallet is frozen. Contact support.', 'WALLET_FROZEN');
    throw new AppError(409, 'INSUFFICIENT_FUNDS', 'Insufficient wallet balance');
  }
  return r.rows[0]!.balance;
}

export async function credit(c: pg.PoolClient, walletDbId: string, amount: string): Promise<string> {
  const r = await c.query<{ balance: string }>(`UPDATE ${S}.wallets SET balance = balance + $2::numeric WHERE id = $1 RETURNING balance`, [
    walletDbId,
    amount,
  ]);
  if (r.rowCount === 0) throw notFound('Wallet not found', 'WALLET_NOT_FOUND');
  return r.rows[0]!.balance;
}

export interface MoveResult {
  reference: string;
  fromBalance: string;
  toBalance: string;
}

/**
 * Wallet-to-wallet movement: lock both, debit, credit and write both ledger
 * lines (sharing one reference) in the caller's transaction.
 */
export async function walletToWallet(
  c: pg.PoolClient,
  p: {
    fromWalletDbId: string;
    toWalletDbId: string;
    amount: string;
    outType: string;
    inType: string;
    description: string;
    fromName?: string | null;
    toName?: string | null;
    metadata?: Record<string, unknown>;
    allowFrozenSource?: boolean;
  },
): Promise<MoveResult> {
  if (String(p.fromWalletDbId) === String(p.toWalletDbId)) throw badRequest('SAME_WALLET', 'You cannot send money to yourself');
  if (cmp(p.amount, '0') <= 0) throw badRequest('INVALID_AMOUNT', 'Amount must be greater than zero');
  const locked = await lockWallets(c, [p.fromWalletDbId, p.toWalletDbId]);
  const from = locked.get(String(p.fromWalletDbId));
  const to = locked.get(String(p.toWalletDbId));
  if (!from || !to) throw notFound('Wallet not found', 'WALLET_NOT_FOUND');
  if (to.is_frozen) throw forbidden('The receiving wallet cannot accept payments right now', 'RECIPIENT_FROZEN');
  const fromBalance = await debit(c, from.id, p.amount, p.allowFrozenSource);
  const toBalance = await credit(c, to.id, p.amount);
  const reference = crypto.randomUUID();
  await writeLine(c, {
    userId: from.user_id,
    walletId: from.wallet_id,
    type: p.outType,
    amount: `-${p.amount}`,
    description: p.description,
    from: from.wallet_id,
    to: to.wallet_id,
    counterparty: p.toName ?? null,
    reference,
    metadata: p.metadata,
    balanceAfter: fromBalance,
  });
  await writeLine(c, {
    userId: to.user_id,
    walletId: to.wallet_id,
    type: p.inType,
    amount: p.amount,
    description: p.description,
    from: from.wallet_id,
    to: to.wallet_id,
    counterparty: p.fromName ?? null,
    reference,
    metadata: p.metadata,
    balanceAfter: toBalance,
  });
  return { reference, fromBalance, toBalance };
}

/** Outgoing daily limit across all debit types, evaluated under the wallet lock. */
export async function assertDailyLimit(c: pg.PoolClient, walletPublicId: string, amount: string) {
  const r = await one<{ total: string }>(
    `SELECT COALESCE(-SUM(amount), 0)::text AS total FROM ${S}.transactions
      WHERE wallet_id = $1 AND amount < 0 AND status IN ('completed','pending')
        AND transaction_type IN ('transfer_out','deposit','purchase','payment')
        AND created_at >= date_trunc('day', now())`,
    [walletPublicId],
    c,
  );
  if (toCents(r?.total ?? '0') + toCents(amount) > toCents(env.DAILY_TRANSFER_LIMIT)) {
    throw new AppError(409, 'DAILY_LIMIT', `Daily limit of ${env.DAILY_TRANSFER_LIMIT} ${env.CURRENCY} reached`);
  }
}

export function assertMaxTransfer(amount: string) {
  if (cmp(amount, env.MAX_TRANSFER) > 0) throw badRequest('LIMIT_EXCEEDED', `Maximum per operation is ${env.MAX_TRANSFER} ${env.CURRENCY}`);
}

export async function notify(c: pg.PoolClient | undefined, userId: string, type: string, title: string, body: string, metadata: Record<string, unknown> = {}) {
  await one(`INSERT INTO ${S}.notifications (user_id, type, title, body, metadata) VALUES ($1, $2, $3, $4, $5)`, [
    userId,
    type,
    title,
    body,
    JSON.stringify(metadata),
  ], c);
}

export const maskName = (name: string | null | undefined) =>
  (name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p : `${p[0]}.`))
    .join(' ');

/**
 * Bilingual notification: English stored as title/body (legacy readers), Arabic in
 * metadata.ar — the app shows whichever matches the reader's language.
 */
export async function notifyBi(
  c: pg.PoolClient | undefined,
  userId: string,
  type: string,
  en: [string, string],
  ar: [string, string],
  metadata: Record<string, unknown> = {},
) {
  await notify(c, userId, type, en[0], en[1], { ...metadata, ar: { title: ar[0], body: ar[1] } });
}

import type pg from 'pg';
import { env } from '../config/env.js';
import { one, S } from '../lib/db.js';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { cmp, toCents } from '../lib/money.js';

export type TxType = 'transfer' | 'deposit' | 'withdrawal' | 'taler_withdraw' | 'taler_deposit' | 'wire' | 'fee';

export interface MoveInput {
  fromAccountId: string;
  toAccountId: string;
  amount: string; // normalized decimal string
  type: TxType;
  subject?: string | null;
  metadata?: Record<string, unknown>;
  initiatedBy?: string | null;
  requestUid?: string | null;
  /** Ignore the lock flag of the debited account (admin/teller operations). */
  allowLockedSource?: boolean;
}

export interface LedgerTx {
  id: string;
  reference: string;
  amount: string;
  currency: string;
  type: TxType;
  status: string;
  subject: string | null;
  from_account_id: string;
  to_account_id: string;
  from_balance_after: string;
  to_balance_after: string;
  created_at: string;
}

interface LockedAccount {
  id: string;
  user_id: string;
  balance: string;
  debit_threshold: string | null;
  is_locked: boolean;
  currency: string;
}

/**
 * Locks accounts in a deterministic order (by id) so two opposite transfers
 * can never deadlock each other, then returns them keyed by id.
 */
export async function lockAccounts(c: pg.PoolClient, ids: string[]): Promise<Map<string, LockedAccount>> {
  const unique = Array.from(new Set(ids));
  const r = await c.query<LockedAccount>(
    `SELECT id, user_id, balance, debit_threshold, is_locked, currency
       FROM ${S}.bank_accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
    [unique],
  );
  return new Map(r.rows.map((row) => [row.id, row]));
}

/**
 * The ONLY way money moves. Must run inside a transaction (tx()).
 * Double-entry: one row in transactions, debit + credit in the same commit.
 * The conditional UPDATE is the final guard against overdrafts, backed by
 * the bank_accounts_balance_floor CHECK constraint in the database.
 */
export async function move(c: pg.PoolClient, input: MoveInput): Promise<LedgerTx> {
  if (input.fromAccountId === input.toAccountId) throw badRequest('SAME_ACCOUNT', 'Source and destination are the same account');
  if (cmp(input.amount, '0') <= 0) throw badRequest('INVALID_AMOUNT', 'Amount must be greater than zero');

  const accounts = await lockAccounts(c, [input.fromAccountId, input.toAccountId]);
  const from = accounts.get(input.fromAccountId);
  const to = accounts.get(input.toAccountId);
  if (!from || !to) throw notFound('Account not found', 'ACCOUNT_NOT_FOUND');
  if (from.is_locked && !input.allowLockedSource) throw forbidden('The source account is frozen', 'ACCOUNT_LOCKED');
  if (to.is_locked) throw forbidden('The destination account cannot receive money right now', 'DESTINATION_LOCKED');
  if (from.currency !== to.currency) throw badRequest('CURRENCY_MISMATCH', 'Accounts use different currencies');

  const debited = await c.query<{ balance: string }>(
    `UPDATE ${S}.bank_accounts SET balance = balance - $2::numeric
      WHERE id = $1 AND balance - $2::numeric >= -COALESCE(debit_threshold, 0)
      RETURNING balance`,
    [from.id, input.amount],
  );
  if (debited.rowCount === 0) throw new AppError(409, 'INSUFFICIENT_FUNDS', 'Insufficient funds');

  const credited = await c.query<{ balance: string }>(
    `UPDATE ${S}.bank_accounts SET balance = balance + $2::numeric WHERE id = $1 RETURNING balance`,
    [to.id, input.amount],
  );

  const tx = await one<LedgerTx>(
    `INSERT INTO ${S}.transactions
       (from_account_id, to_account_id, amount, currency, type, status, subject, metadata,
        from_balance_after, to_balance_after, initiated_by, request_uid)
     VALUES ($1, $2, $3::numeric, $4, $5, 'completed', $6, $7, $8, $9, $10, $11)
     RETURNING id, reference, amount, currency, type, status, subject, from_account_id, to_account_id,
               from_balance_after, to_balance_after, created_at`,
    [
      from.id,
      to.id,
      input.amount,
      from.currency,
      input.type,
      input.subject ?? null,
      JSON.stringify(input.metadata ?? {}),
      debited.rows[0]!.balance,
      credited.rows[0]!.balance,
      input.initiatedBy ?? null,
      input.requestUid ?? null,
    ],
    c,
  );
  return tx!;
}

/** Customer daily outgoing limit, evaluated while the source account is locked (race-free). */
export async function assertDailyLimit(c: pg.PoolClient, userId: string, amount: string): Promise<void> {
  const r = await one<{ total: string }>(
    `SELECT COALESCE(SUM(t.amount), 0)::text AS total
       FROM ${S}.transactions t JOIN ${S}.bank_accounts a ON a.id = t.from_account_id
      WHERE a.user_id = $1 AND t.type IN ('transfer','taler_withdraw') AND t.status = 'completed'
        AND t.created_at >= date_trunc('day', now())`,
    [userId],
    c,
  );
  if (toCents(r?.total ?? '0') + toCents(amount) > toCents(env.DAILY_TRANSFER_LIMIT)) {
    throw new AppError(409, 'DAILY_LIMIT', `Daily limit of ${env.DAILY_TRANSFER_LIMIT} ${env.CURRENCY} reached`);
  }
}

export function assertMaxTransfer(amount: string): void {
  if (cmp(amount, env.MAX_TRANSFER) > 0) {
    throw badRequest('LIMIT_EXCEEDED', `Maximum per transfer is ${env.MAX_TRANSFER} ${env.CURRENCY}`);
  }
}

export async function exchangeAccount(c?: pg.PoolClient) {
  const acc = await one<{ id: string; iban: string; payto_uri: string; balance: string; user_id: string }>(
    `SELECT id, iban, payto_uri, balance, user_id FROM ${S}.bank_accounts WHERE is_taler_exchange = true ORDER BY created_at ASC LIMIT 1`,
    [],
    c,
  );
  if (!acc) throw new AppError(503, 'EXCHANGE_MISSING', 'Exchange account is not configured');
  return acc;
}

export async function centralAccount(c?: pg.PoolClient) {
  const acc = await one<{ id: string; iban: string; balance: string }>(
    `SELECT a.id, a.iban, a.balance FROM ${S}.bank_accounts a JOIN ${S}.users u ON u.id = a.user_id
      WHERE u.role = 'admin' AND a.is_taler_exchange = false ORDER BY a.created_at ASC LIMIT 1`,
    [],
    c,
  );
  if (!acc) throw new AppError(503, 'CENTRAL_MISSING', 'Central bank account is not configured (set BANK_ADMIN_EMAIL/PASSWORD)');
  return acc;
}

export async function notify(
  c: pg.PoolClient | undefined,
  userId: string,
  type: string,
  title: string,
  body: string,
  metadata: Record<string, unknown> = {},
) {
  await one(
    `INSERT INTO ${S}.notifications (user_id, type, title, body, metadata) VALUES ($1, $2, $3, $4, $5)`,
    [userId, type, title, body, JSON.stringify(metadata)],
    c,
  );
}

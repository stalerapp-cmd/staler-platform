import { env } from '../config/env.js';
import { AppError } from './errors.js';
import { logger } from './logger.js';

/**
 * Typed client for TalerBank. Distinguishes three outcomes, which the money
 * flows depend on:
 *   - success
 *   - BankRejected  : the bank answered 4xx — the operation definitely did NOT happen
 *   - BankUnreachable: network error / timeout / 5xx — outcome UNKNOWN, must be reconciled
 */
export class BankRejected extends AppError {
  constructor(status: number, code: string, message: string) {
    super(status >= 500 ? 502 : status, code, message);
  }
}
export class BankUnreachable extends AppError {
  constructor(message = 'The bank is not reachable right now') {
    super(502, 'BANK_UNAVAILABLE', message);
  }
}

const base = env.BANK_API_URL.replace(/\/+$/, '');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Reads are safe to repeat, so when the bank is waking up (its host answers 502/503/504
 * or the connection drops) we wait and try again before giving up. Writes are never
 * repeated here — their outcome is reconciled instead.
 */
async function call<T>(method: string, path: string, opts: { token?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const waits = method === 'GET' && process.env.NODE_ENV !== 'test' ? [1500, 4000, 8000] : [];
  for (let i = 0; ; i++) {
    try {
      return await once<T>(method, path, opts);
    } catch (e) {
      if (!(e instanceof BankUnreachable) || i >= waits.length || (e as any).retryable === false) throw e;
      await sleep(waits[i]!);
    }
  }
}

async function once<T>(method: string, path: string, opts: { token?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
      redirect: 'error',
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message, path }, 'bank unreachable');
    throw new BankUnreachable();
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (res.status >= 500) {
    logger.warn({ status: res.status, path }, 'bank server error');
    // 502/503/504 come from the bank's host while it starts up; a 500 is the bank itself.
    if (res.status >= 502) throw new BankUnreachable('The bank is waking up — try again in a few seconds');
    throw new BankUnreachable('The bank had a problem — your request will be checked automatically');
  }
  if (!res.ok) {
    const code = String(json?.error?.code ?? `BANK_${res.status}`).slice(0, 64);
    const message = String(json?.error?.message ?? 'The bank refused the request').slice(0, 200);
    // A bank-side 401 must never look like OUR session expired (that would log the user out).
    if (res.status === 401 || res.status === 403) {
      if (code === 'LINK_REVOKED' || (opts.token && opts.token !== env.EXCHANGE_API_TOKEN && code === 'UNAUTHORIZED')) {
        throw new BankRejected(409, 'BANK_LINK_REVOKED', 'Your bank link expired or was revoked. Please link your bank again.');
      }
      if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN') {
        logger.error({ path, code }, 'bank rejected exchange credentials — check EXCHANGE_API_TOKEN');
        throw Object.assign(new BankUnreachable('Bank integration is misconfigured'), { retryable: false });
      }
      throw new BankRejected(res.status === 403 ? 403 : 400, code, message);
    }
    throw new BankRejected(res.status, code, message);
  }
  return json as T;
}

const EX = () => env.EXCHANGE_API_TOKEN;

export interface LinkResult {
  token: string;
  expiresAt: string;
  account: { iban: string; holder: string; currency: string; payto: string };
}
export interface BankOperation {
  operation_id: string;
  status: 'pending' | 'selected' | 'confirmed' | 'aborted';
  amount: string;
  amount_value: string;
  currency: string;
  transfer_done: boolean;
  aborted: boolean;
  reserve_pub: string | null;
  account_holder?: string;
  confirm_transfer_url?: string;
  expires_at?: string;
}

export const bank = {
  redeemLinkCode: (code: string, walletRef: string) =>
    call<{ data: LinkResult }>('POST', '/link/redeem-code', { token: EX(), body: { code, clientName: env.SITE_NAME, walletRef } }).then((r) => r.data),

  linkWithCredentials: (login: string, password: string, totp: string | undefined, walletRef: string) =>
    call<{ data: LinkResult }>('POST', '/link/credentials', {
      token: EX(),
      body: { login, password, ...(totp ? { totp } : {}), clientName: env.SITE_NAME, walletRef },
    }).then((r) => r.data),

  linkedAccount: (linkToken: string) =>
    call<{ data: { iban: string; holder: string; currency: string; balance: string; locked: boolean; payto: string } }>('GET', '/link/account', {
      token: linkToken,
    }).then((r) => r.data),

  linkWithdraw: (linkToken: string, amount: string, reservePub: string, requestUid: string) =>
    call<{ data: { transactionId: string; status: string } }>('POST', '/link/withdraw', {
      token: linkToken,
      body: { amount, reserve_pub: reservePub, request_uid: requestUid },
    }).then((r) => r.data),

  revokeLink: (linkToken: string) => call('DELETE', '/link/token', { token: linkToken }),

  getOperation: (opId: string) => call<BankOperation>('GET', `/taler-integration/withdrawal-operation/${encodeURIComponent(opId)}`),

  selectOperation: (opId: string, reservePub: string, walletRef: string) =>
    call<BankOperation>('POST', `/taler-integration/withdrawal-operation/${encodeURIComponent(opId)}`, {
      token: EX(),
      body: { reserve_pub: reservePub, wallet_ref: walletRef },
    }),

  abortOperation: (opId: string) => call('POST', `/taler-integration/withdrawal-operation/${encodeURIComponent(opId)}/abort`, { token: EX() }),

  wireTransfer: (requestUid: string, amount: string, creditPayto: string, subject: string) =>
    call<{ data: { row_id: string; transaction_id: string; status: string } }>('POST', '/taler-wire-gateway/transfer', {
      token: EX(),
      body: { request_uid: requestUid, amount: `${env.CURRENCY}:${amount}`, credit_account: creditPayto, subject },
    }).then((r) => r.data),

  wireTransferStatus: (requestUid: string) =>
    call<{ data: { status: string } }>('GET', `/taler-wire-gateway/transfer/${encodeURIComponent(requestUid)}`, { token: EX() }).then((r) => r.data),

  reserveStatus: (reservePub: string) =>
    call<{ data: { reserve_pub: string; amount: string; status: string } }>('GET', `/taler-wire-gateway/reserves/${encodeURIComponent(reservePub)}`, {
      token: EX(),
    }).then((r) => r.data),

  exchangeAccount: () =>
    call<{ data: { iban: string; balance: string; currency: string; total_in: string; total_out: string } }>('GET', '/taler-wire-gateway/account', {
      token: EX(),
    }).then((r) => r.data),

  health: () => call<{ status: string }>('GET', '/health', { timeoutMs: 5000 }),
};

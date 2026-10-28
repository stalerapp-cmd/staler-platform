import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { outbox } from '../src/lib/mailer.js';
import { BANK_PORT, EXCHANGE_TOKEN, STALER_PORT, WEBHOOK_SECRET } from './env.js';

export const STRONG = 'Str0ng!Passw0rd#';
let n = 0;
export const uniq = (p = 'u') => `${p}${Date.now().toString(36)}${(n++).toString(36)}`;
export const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// ------------------------------------------------------------ real bank process
const bankLogs: string[] = [];
let bankProc: ChildProcess | null = null;
export const BANK = `http://127.0.0.1:${BANK_PORT}`;

export async function startBank() {
  const bankDir = join(__dirname, '..', '..', 'bank-api');
  bankProc = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: bankDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(BANK_PORT),
      DATABASE_URL: process.env.TEST_DATABASE_URL_BANK_E2E ?? 'postgres://postgres@127.0.0.1:5433/talerbank_e2e',
      DB_SSL: 'disable',
      JWT_SECRET: 'bank-e2e-jwt-secret-long-enough-0123456789', // gitleaks:allow (test-only value)
      ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
      EXCHANGE_API_TOKEN: EXCHANGE_TOKEN,
      WEBHOOK_SECRET,
      STALER_WEBHOOK_URL: `http://127.0.0.1:${STALER_PORT}/api/bank/webhook`,
      BANK_ADMIN_EMAIL: 'admin@bank.test',
      BANK_ADMIN_PASSWORD: 'Bank!Admin#2026x',
      SIGNUP_BONUS: '1000',
      MAIL_MODE: 'log',
      LOG_LEVEL: 'info',
      DISABLE_RATE_LIMIT: 'true',
      PUBLIC_URL: `http://127.0.0.1:${BANK_PORT}`,
      MAX_TRANSFER: '5000',
      DAILY_TRANSFER_LIMIT: '20000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (b: Buffer) => bankLogs.push(...b.toString().split('\n').filter(Boolean));
  bankProc.stdout!.on('data', collect);
  bankProc.stderr!.on('data', collect);
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BANK}/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`bank did not start:\n${bankLogs.slice(-30).join('\n')}`);
}

export async function stopBank() {
  bankProc?.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
}

export function bankMailCode(email: string): string {
  for (let i = bankLogs.length - 1; i >= 0; i--) {
    const line = bankLogs[i]!;
    if (line.includes(email) && line.includes('mail (log mode)')) {
      const m = /: (\d{6})"/.exec(line);
      if (m) return m[1]!;
    }
  }
  throw new Error(`no bank mail for ${email}`);
}

async function bankCall(method: string, path: string, body?: unknown, token?: string) {
  const r = await fetch(`${BANK}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}
export const bankApi = {
  post: (p: string, b?: unknown, t?: string) => bankCall('POST', p, b, t),
  get: (p: string, t?: string) => bankCall('GET', p, undefined, t),
  del: (p: string, t?: string) => bankCall('DELETE', p, undefined, t),
};

export interface BankCustomer {
  email: string;
  token: string;
  accountId: string;
  iban: string;
}
export async function bankCustomer(name = 'Bank Customer'): Promise<BankCustomer> {
  const username = uniq('bk');
  const email = `${username}@bank.example`;
  const r = await bankApi.post('/api/auth/register', { fullName: name, email, username, password: STRONG });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  await new Promise((res) => setTimeout(res, 150));
  const v = await bankApi.post('/api/auth/verify-email', { email, code: bankMailCode(email) });
  const token = v.body.data.accessToken;
  const acc = await bankApi.get('/api/accounts', token);
  return { email, token, accountId: acc.body.data.accounts[0].id, iban: acc.body.data.accounts[0].iban };
}
export async function bankBalance(c: BankCustomer): Promise<string> {
  return (await bankApi.get('/api/accounts', c.token)).body.data.accounts[0].balance;
}

// ------------------------------------------------------------------ S-Taler users
export function lastCode(to: string): string {
  for (let i = outbox.length - 1; i >= 0; i--) {
    if (outbox[i]!.to === to) {
      const m = /(\d{6})/.exec(outbox[i]!.text);
      if (m) return m[1]!;
    }
  }
  throw new Error(`no code mailed to ${to}`);
}

export interface WalletUser {
  email: string;
  token: string;
  cookie: string;
  userId: string;
  walletId: string;
}
export async function walletUser(app: Express, name = 'Wallet User', accountType: 'user' | 'merchant' = 'user'): Promise<WalletUser> {
  const email = `${uniq('w')}@example.com`;
  const r1 = await request(app).post('/api/auth/register').send({ fullName: name, email, password: STRONG, accountType });
  if (r1.status !== 201) throw new Error(JSON.stringify(r1.body));
  const r2 = await request(app).post('/api/auth/verify-email').send({ email, code: lastCode(email) });
  if (r2.status !== 201) throw new Error(JSON.stringify(r2.body));
  return {
    email,
    token: r2.body.data.accessToken,
    cookie: String(r2.headers['set-cookie']?.[0] ?? '').split(';')[0]!,
    userId: r2.body.data.user.id,
    walletId: r2.body.data.user.wallet_id,
  };
}
export async function walletBalance(app: Express, u: WalletUser): Promise<string> {
  return (await request(app).get('/api/wallet').set(auth(u.token))).body.data.wallet.balance;
}
export async function login(app: Express, email: string, password: string): Promise<string> {
  const r = await request(app).post('/api/auth/login').send({ email, password });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  return r.body.data.accessToken;
}

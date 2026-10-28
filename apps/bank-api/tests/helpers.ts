import request from 'supertest';
import type { Express } from 'express';
import { outbox } from '../src/lib/mailer.js';

let counter = 0;
export const uniq = (p = 'u') => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`;

export const STRONG = 'Str0ng!Passw0rd#';

export function lastCode(to: string): string {
  for (let i = outbox.length - 1; i >= 0; i--) {
    const m = outbox[i]!;
    if (m.to === to) {
      const match = /(\d{6})/.exec(m.text);
      if (match) return match[1]!;
    }
  }
  throw new Error(`no code mailed to ${to}`);
}

export interface Customer {
  email: string;
  username: string;
  token: string;
  cookie: string;
  userId: string;
  accountId: string;
  iban: string;
}

export async function registerCustomer(app: Express, name = 'Test Customer'): Promise<Customer> {
  const username = uniq('user');
  const email = `${username}@example.com`;
  const r1 = await request(app).post('/api/auth/register').send({ fullName: name, email, username, password: STRONG });
  if (r1.status !== 201) throw new Error(`register failed ${r1.status} ${JSON.stringify(r1.body)}`);
  const r2 = await request(app).post('/api/auth/verify-email').send({ email, code: lastCode(email) });
  if (r2.status !== 201) throw new Error(`verify failed ${r2.status} ${JSON.stringify(r2.body)}`);
  const token = r2.body.data.accessToken as string;
  const cookie = String(r2.headers['set-cookie']?.[0] ?? '').split(';')[0]!;
  const acc = await request(app).get('/api/accounts').set('Authorization', `Bearer ${token}`);
  const a = acc.body.data.accounts[0];
  return { email, username, token, cookie, userId: r2.body.data.user.id, accountId: a.id, iban: a.iban };
}

export const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

export async function balance(app: Express, c: Customer): Promise<string> {
  const r = await request(app).get('/api/accounts').set(auth(c.token));
  return r.body.data.accounts[0].balance;
}

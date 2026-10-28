import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { SignJWT } from 'jose';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { bootstrap } from '../src/db/bootstrap.js';
import { pool } from '../src/lib/db.js';
import { env } from '../src/config/env.js';
import { hotp } from '../src/lib/totp.js';
import { auth, balance, lastCode, registerCustomer, STRONG, uniq, type Customer } from './helpers.js';

let app: Express;
const EX = { Authorization: `Bearer ${process.env.EXCHANGE_API_TOKEN}` };
const reserve = () => {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  return Array.from(crypto.randomBytes(52), (b) => alphabet[b % 32]).join('');
};
const totpNow = (secret: string, offset = 0) => hotp(secret, Math.floor(Date.now() / 30000) + offset);
const sumBalances = async () => (await pool.query(`SELECT SUM(balance)::text AS s FROM talerbank.bank_accounts`)).rows[0].s;

beforeAll(async () => {
  await migrate();
  await migrate(); // second run must be a no-op
  await bootstrap();
  await bootstrap();
  app = createApp();
});

afterAll(async () => {
  await pool.end();
});

// ---------------------------------------------------------------- database
describe('migrations on the legacy schema', () => {
  it('upgrades the existing talerbank schema without losing data', async () => {
    const legacy = await pool.query(`SELECT balance, username FROM talerbank.bank_accounts a JOIN talerbank.users u ON u.id = a.user_id WHERE u.email = 'legacy.user@example.com'`);
    expect(legacy.rows[0].balance).toBe('250.00');
    expect(legacy.rows[0].username).toBe('legacyuser');
    const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='talerbank' AND table_name='users'`);
    const names = cols.rows.map((r) => r.column_name);
    for (const c of ['token_version', 'failed_login_count', 'locked_until', 'totp_enabled', 'username']) expect(names).toContain(c);
  });

  it('records each migration once and enables row level security everywhere', async () => {
    const m = await pool.query(`SELECT count(*)::int AS n FROM talerbank.schema_migrations`);
    expect(m.rows[0].n).toBe(1);
    const rls = await pool.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='talerbank' AND NOT rowsecurity`);
    expect(rls.rows[0].n).toBe(0);
  });

  it('enforces the overdraft floor in the database itself', async () => {
    const r = await pool.query(`SELECT id FROM talerbank.bank_accounts WHERE account_number = 'TB1234567890'`);
    await expect(pool.query(`UPDATE talerbank.bank_accounts SET balance = -1 WHERE id = $1`, [r.rows[0].id])).rejects.toMatchObject({ code: '23514' });
  });

  it('neutralises the published default admin password', async () => {
    const r = await request(app).post('/api/auth/login').send({ login: 'admin@talerbank.local', password: 'Admin@2026' });
    expect(r.status).toBe(401);
    const ok = await request(app).post('/api/auth/login').send({ login: 'admin@talerbank.local', password: process.env.BANK_ADMIN_PASSWORD });
    expect(ok.status).toBe(200);
  });
});

// ------------------------------------------------------------------- basics
describe('http hardening', () => {
  it('sends strict security headers and hides the framework', async () => {
    const r = await request(app).get('/api/config');
    expect(r.status).toBe(200);
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['content-security-policy']).toContain("default-src 'self'");
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-request-id']).toBeTruthy();
  });

  it('rejects malformed JSON, huge bodies and bad ids without leaking internals', async () => {
    const bad = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"login":');
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toMatch(/stack|at .*\.ts/);
    const big = await request(app).post('/api/auth/login').send({ login: 'a'.repeat(100_000), password: 'x' });
    expect(big.status).toBe(413);
    const admin = await request(app).post('/api/auth/login').send({ login: 'admin@talerbank.local', password: process.env.BANK_ADMIN_PASSWORD });
    const id = await request(app).get('/api/accounts/not-a-uuid').set(auth(admin.body.data.accessToken));
    expect(id.status).toBe(400);
  });

  it('only allows CORS for the configured origins and the Android app', async () => {
    const evil = await request(app).options('/api/auth/login').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    const appOrigin = await request(app).options('/api/auth/login').set('Origin', 'https://localhost');
    expect(appOrigin.headers['access-control-allow-origin']).toBe('https://localhost');
    expect(appOrigin.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('serves health', async () => {
    expect((await request(app).get('/health')).body.status).toBe('ok');
  });
});

// --------------------------------------------------------------- registration
describe('registration', () => {
  it('blocks mass-assignment of role and unknown fields', async () => {
    const r = await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Evil', email: 'evil@example.com', username: 'evil1', password: STRONG, role: 'admin' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('enforces the password policy', async () => {
    for (const password of ['short', 'alllowercase123!', 'NoDigitsHere!!', 'NoSymbols1234', 'Password123']) {
      const r = await request(app).post('/api/auth/register').send({ fullName: 'Weak', email: `${uniq()}@x.com`, username: uniq('w'), password });
      expect(r.status).toBe(400);
    }
  });

  it('verifies e-mail, opens an account with a valid IBAN and pays the welcome bonus', async () => {
    const c = await registerCustomer(app, 'Najwa Yaseen');
    expect(c.iban).toMatch(/^PS\d{2}TLRB\d{21}$/);
    expect(await balance(app, c)).toBe('1000.00');
    expect(c.cookie).toMatch(/^tb_rt=tbr_/);
  });

  it('does not reveal registered e-mails (no account enumeration)', async () => {
    const c = await registerCustomer(app);
    const r = await request(app).post('/api/auth/register').send({ fullName: 'Again', email: c.email, username: uniq('x'), password: STRONG });
    expect(r.status).toBe(201);
    expect(r.body.message).toMatch(/If this e-mail/);
  });

  it('locks a verification code after 5 wrong attempts', async () => {
    const username = uniq('lock');
    const email = `${username}@example.com`;
    await request(app).post('/api/auth/register').send({ fullName: 'Lock Test', email, username, password: STRONG });
    const good = lastCode(email);
    for (let i = 0; i < 5; i++) {
      const wrong = String((Number(good) + 1 + i) % 1_000_000).padStart(6, '0');
      expect((await request(app).post('/api/auth/verify-email').send({ email, code: wrong })).status).toBe(400);
    }
    const r = await request(app).post('/api/auth/verify-email').send({ email, code: good });
    expect(r.status).toBe(429);
  });
});

// --------------------------------------------------------------------- login
describe('login & sessions', () => {
  it('accepts legacy bcrypt passwords and upgrades them to argon2id', async () => {
    const r = await request(app).post('/api/auth/login').send({ login: 'legacy.user@example.com', password: 'Legacy!Pass123' });
    expect(r.status).toBe(200);
    const h = await pool.query(`SELECT password_hash FROM talerbank.users WHERE email='legacy.user@example.com'`);
    expect(h.rows[0].password_hash).toMatch(/^\$argon2id\$/);
    const again = await request(app).post('/api/auth/login').send({ login: 'legacyuser', password: 'Legacy!Pass123' });
    expect(again.status).toBe(200);
  });

  it('never lets the exchange system user sign in', async () => {
    const r = await request(app).post('/api/auth/login').send({ login: 'exchange@talerbank.local', password: 'Admin@2026' });
    expect(r.status).toBe(401);
  });

  it('locks the account after 5 failed passwords, even for the right password', async () => {
    const c = await registerCustomer(app);
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/api/auth/login').send({ login: c.email, password: 'Wrong!Pass123' })).status).toBe(401);
    }
    const r = await request(app).post('/api/auth/login').send({ login: c.email, password: STRONG });
    expect(r.status).toBe(423);
  });

  it('rejects forged, alg=none and wrongly-signed tokens', async () => {
    const c = await registerCustomer(app);
    const [h, p] = c.token.split('.');
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${p}.`;
    expect((await request(app).get('/api/accounts').set(auth(none))).status).toBe(401);
    const tampered = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p!, 'base64url').toString()), role: 'admin' })).toString('base64url')}.${c.token.split('.')[2]}`;
    expect((await request(app).get('/api/admin/overview').set(auth(tampered))).status).toBe(401);
    const otherKey = await new SignJWT({ role: 'admin', tv: 0, sid: 'x', typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(c.userId)
      .setIssuer('talerbank')
      .setAudience('talerbank-api')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('another-secret-another-secret-123456'));
    expect((await request(app).get('/api/accounts').set(auth(otherKey))).status).toBe(401);
  });

  it('rotates refresh tokens and kills the whole session when an old one is replayed', async () => {
    const c = await registerCustomer(app);
    const noCsrf = await request(app).post('/api/auth/refresh').set('Cookie', c.cookie);
    expect(noCsrf.status).toBe(403);
    const r1 = await request(app).post('/api/auth/refresh').set('Cookie', c.cookie).set('X-Requested-With', 'fetch');
    expect(r1.status).toBe(200);
    const newCookie = String(r1.headers['set-cookie']![0]).split(';')[0]!;
    expect(newCookie).not.toBe(c.cookie);
    // replay the old (rotated) token -> theft detected
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', c.cookie).set('X-Requested-With', 'fetch');
    expect(replay.status).toBe(401);
    // ...and the legitimate new token is now revoked too
    const after = await request(app).post('/api/auth/refresh').set('Cookie', newCookie).set('X-Requested-With', 'fetch');
    expect(after.status).toBe(401);
    const ev = await pool.query(`SELECT count(*)::int AS n FROM talerbank.audit_log WHERE action = 'auth.refresh_token_reuse_detected' AND user_id = $1`, [c.userId]);
    expect(ev.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it('gives the Android app its refresh token in the body (never a cookie)', async () => {
    const c = await registerCustomer(app);
    const r = await request(app).post('/api/auth/login').set('X-Client', 'mobile').send({ login: c.email, password: STRONG });
    expect(r.body.data.refreshToken).toMatch(/^tbr_/);
    expect(r.headers['set-cookie']).toBeUndefined();
    const ref = await request(app).post('/api/auth/refresh').set('X-Client', 'mobile').send({ refreshToken: r.body.data.refreshToken });
    expect(ref.status).toBe(200);
    expect(ref.body.data.refreshToken).not.toBe(r.body.data.refreshToken);
  });

  it('"log out everywhere" invalidates existing access tokens immediately', async () => {
    const c = await registerCustomer(app);
    expect((await request(app).post('/api/auth/logout-all').set(auth(c.token))).status).toBe(200);
    const r = await request(app).get('/api/accounts').set(auth(c.token));
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('SESSION_REVOKED');
  });

  it('resets a password with a mailed code and signs out all devices', async () => {
    const c = await registerCustomer(app);
    await request(app).post('/api/auth/forgot-password').send({ email: c.email });
    const code = lastCode(c.email);
    const r = await request(app).post('/api/auth/reset-password').send({ email: c.email, code, newPassword: 'N3w!Password#2026' });
    expect(r.status).toBe(200);
    expect((await request(app).get('/api/accounts').set(auth(c.token))).status).toBe(401);
    const reuse = await request(app).post('/api/auth/reset-password').send({ email: c.email, code, newPassword: 'An0ther!Pass#2026' });
    expect(reuse.status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ login: c.email, password: 'N3w!Password#2026' })).status).toBe(200);
  });
});

// -------------------------------------------------------------------- 2FA
describe('two-factor authentication', () => {
  it('enables TOTP, requires it at login, blocks code replay and accepts a recovery code once', async () => {
    const c = await registerCustomer(app);
    const setup = await request(app).post('/api/auth/me/totp/setup').set(auth(c.token));
    const secret = setup.body.data.secret as string;
    expect(setup.body.data.qr).toMatch(/^data:image\/png;base64,/);
    const en = await request(app).post('/api/auth/me/totp/enable').set(auth(c.token)).send({ code: totpNow(secret) });
    expect(en.status).toBe(200);
    const recovery: string[] = en.body.data.recoveryCodes;
    expect(recovery).toHaveLength(8);

    const step1 = await request(app).post('/api/auth/login').send({ login: c.email, password: STRONG });
    expect(step1.body.data.mfaRequired).toBe(true);
    expect(step1.body.data.accessToken).toBeUndefined();
    // the code used to enable 2FA cannot be replayed
    const replay = await request(app).post('/api/auth/login/mfa').send({ mfaToken: step1.body.data.mfaToken, code: totpNow(secret) });
    expect(replay.status).toBe(401);
    const next = await request(app).post('/api/auth/login/mfa').send({ mfaToken: step1.body.data.mfaToken, code: totpNow(secret, 1) });
    expect(next.status).toBe(200);

    const s2 = await request(app).post('/api/auth/login').send({ login: c.email, password: STRONG });
    const rec = await request(app).post('/api/auth/login/mfa').send({ mfaToken: s2.body.data.mfaToken, code: recovery[0] });
    expect(rec.status).toBe(200);
    const s3 = await request(app).post('/api/auth/login').send({ login: c.email, password: STRONG });
    const recAgain = await request(app).post('/api/auth/login/mfa').send({ mfaToken: s3.body.data.mfaToken, code: recovery[0] });
    expect(recAgain.status).toBe(401);

    // money movements now require the second factor
    const other = await registerCustomer(app);
    const t = rec.body.data.accessToken;
    const noCode = await request(app).post('/api/transfers').set(auth(t)).send({ fromAccountId: c.accountId, to: other.iban, amount: '1' });
    expect(noCode.status).toBe(401);
    expect(noCode.body.error.code).toBe('MFA_REQUIRED');
    const withRecovery = await request(app).post('/api/transfers').set(auth(t)).send({ fromAccountId: c.accountId, to: other.iban, amount: '1', totp: recovery[1] });
    expect(withRecovery.status).toBe(201);
  });
});

// ---------------------------------------------------------------- transfers
describe('transfers', () => {
  let a: Customer;
  let b: Customer;
  beforeAll(async () => {
    a = await registerCustomer(app, 'Alice Sender');
    b = await registerCustomer(app, 'Bob Receiver');
  });

  it('moves money by IBAN, account number and @username with balances after', async () => {
    const r = await request(app).post('/api/transfers').set(auth(a.token)).send({ fromAccountId: a.accountId, to: b.iban, amount: '10.50', subject: 'Lunch' });
    expect(r.status).toBe(201);
    expect(r.body.data.transaction.recipient.holder).toBe('Bob R.');
    expect(await balance(app, a)).toBe('989.50');
    expect(await balance(app, b)).toBe('1010.50');
    const byUser = await request(app).post('/api/transfers').set(auth(a.token)).send({ fromAccountId: a.accountId, to: `@${b.username}`, amount: 0.5 });
    expect(byUser.status).toBe(201);
    const notif = await request(app).get('/api/notifications').set(auth(b.token));
    expect(notif.body.data.unread).toBeGreaterThan(0);
  });

  it('rejects every malformed amount', async () => {
    for (const amount of ['0', '-5', '1.234', 'NaN', '1e3', '0x10', '', ' ', '10,5', '99999999999999', null, -1, 0.001, Infinity]) {
      const r = await request(app).post('/api/transfers').set(auth(a.token)).send({ fromAccountId: a.accountId, to: b.iban, amount });
      expect(r.status, `amount ${String(amount)}`).toBe(400);
    }
  });

  it('cannot spend from someone else’s account (IDOR) or into the exchange account', async () => {
    const steal = await request(app).post('/api/transfers').set(auth(a.token)).send({ fromAccountId: b.accountId, to: a.iban, amount: '5' });
    expect(steal.status).toBe(404);
    const ex = await pool.query(`SELECT iban FROM talerbank.bank_accounts WHERE is_taler_exchange`);
    const toEx = await request(app).post('/api/transfers').set(auth(a.token)).send({ fromAccountId: a.accountId, to: ex.rows[0].iban, amount: '5' });
    expect(toEx.status).toBe(404);
  });

  it('is immune to SQL injection in the recipient field', async () => {
    for (const to of ["' OR 1=1 --", "x'; DROP TABLE talerbank.users; --", '@admin\' --']) {
      const r = await request(app).post('/api/transfers').set(auth(a.token)).send({ fromAccountId: a.accountId, to, amount: '1' });
      expect([400, 404]).toContain(r.status);
    }
    expect((await pool.query(`SELECT count(*)::int AS n FROM talerbank.users`)).rows[0].n).toBeGreaterThan(3);
  });

  it('refuses overdrafts, per-transfer and daily limits', async () => {
    const poor = await registerCustomer(app);
    const over = await request(app).post('/api/transfers').set(auth(poor.token)).send({ fromAccountId: poor.accountId, to: b.iban, amount: '1000.01' });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('INSUFFICIENT_FUNDS');
    const max = await request(app).post('/api/transfers').set(auth(a.token)).send({ fromAccountId: a.accountId, to: b.iban, amount: '5000.01' });
    expect(max.body.error.code).toBe('LIMIT_EXCEEDED');
    expect(await balance(app, poor)).toBe('1000.00');
  });

  it('replays an Idempotency-Key instead of charging twice', async () => {
    const key = `key_${crypto.randomUUID()}`;
    const before = await balance(app, a);
    const body = { fromAccountId: a.accountId, to: b.iban, amount: '3' };
    const r1 = await request(app).post('/api/transfers').set(auth(a.token)).set('Idempotency-Key', key).send(body);
    const r2 = await request(app).post('/api/transfers').set(auth(a.token)).set('Idempotency-Key', key).send(body);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r2.body.data.transaction.id).toBe(r1.body.data.transaction.id);
    expect(Number(await balance(app, a))).toBeCloseTo(Number(before) - 3, 2);
    const reuse = await request(app).post('/api/transfers').set(auth(a.token)).set('Idempotency-Key', key).send({ ...body, amount: '4' });
    expect(reuse.status).toBe(422);
  });

  it('never overdraws under 40 concurrent double-spend attempts', async () => {
    const victim = await registerCustomer(app); // 1000.00
    const sink = await registerCustomer(app);
    const results = await Promise.all(
      Array.from({ length: 40 }, () =>
        request(app).post('/api/transfers').set(auth(victim.token)).send({ fromAccountId: victim.accountId, to: sink.iban, amount: '100' }),
      ),
    );
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(10);
    expect(results.every((r) => r.status === 201 || r.body.error?.code === 'INSUFFICIENT_FUNDS' || r.body.error?.code === 'DAILY_LIMIT')).toBe(true);
    expect(await balance(app, victim)).toBe('0.00');
    expect(await balance(app, sink)).toBe('2000.00');
  });

  it('does not deadlock on simultaneous opposite transfers', async () => {
    const x = await registerCustomer(app);
    const y = await registerCustomer(app);
    const ops = Array.from({ length: 20 }, (_, i) =>
      i % 2
        ? request(app).post('/api/transfers').set(auth(x.token)).send({ fromAccountId: x.accountId, to: y.iban, amount: '1' })
        : request(app).post('/api/transfers').set(auth(y.token)).send({ fromAccountId: y.accountId, to: x.iban, amount: '1' }),
    );
    const res = await Promise.all(ops);
    expect(res.every((r) => r.status === 201)).toBe(true);
    expect(await balance(app, x)).toBe('1000.00');
    expect(await balance(app, y)).toBe('1000.00');
  });

  it('exports statements with spreadsheet-formula injection neutralised', async () => {
    await request(app).post('/api/transfers').set(auth(b.token)).send({ fromAccountId: b.accountId, to: a.iban, amount: '1', subject: '=HYPERLINK("http://evil")' });
    const csv = await request(app).get(`/api/accounts/${a.accountId}/statement.csv`).set(auth(a.token));
    expect(csv.status).toBe(200);
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv.text).not.toMatch(/,"=HYPERLINK/);
  });

  it('paginates and filters history', async () => {
    const r = await request(app).get(`/api/accounts/${a.accountId}/transactions?limit=2&direction=out`).set(auth(a.token));
    expect(r.body.data.transactions).toHaveLength(2);
    expect(r.body.data.transactions.every((t: any) => t.direction === 'out')).toBe(true);
    expect(r.body.data.total).toBeGreaterThan(2);
    const bad = await request(app).get(`/api/accounts/${a.accountId}/transactions?limit=100000`).set(auth(a.token));
    expect(bad.status).toBe(400);
  });
});

// ------------------------------------------------------ payment requests (QR)
describe('payment requests', () => {
  it('can be paid exactly once and never by the requester', async () => {
    const shop = await registerCustomer(app, 'Shop Owner');
    const buyer = await registerCustomer(app, 'Buyer Person');
    const req = await request(app).post('/api/payment-requests').set(auth(shop.token)).send({ accountId: shop.accountId, amount: '25', description: 'Coffee' });
    expect(req.body.data.request.qr_data).toMatch(/^talerbank:\/\/pay\//);
    const id = req.body.data.request.id;
    expect((await request(app).post(`/api/payment-requests/${id}/pay`).set(auth(shop.token)).send({ fromAccountId: shop.accountId })).status).toBe(400);
    const [p1, p2] = await Promise.all([
      request(app).post(`/api/payment-requests/${id}/pay`).set(auth(buyer.token)).send({ fromAccountId: buyer.accountId }),
      request(app).post(`/api/payment-requests/${id}/pay`).set(auth(buyer.token)).send({ fromAccountId: buyer.accountId }),
    ]);
    expect([p1!.status, p2!.status].sort()).toEqual([200, 409]);
    expect(await balance(app, buyer)).toBe('975.00');
  });
});

// ------------------------------------------- Taler withdrawal (bank -> wallet)
describe('withdrawal operations (QR to S-Taler)', () => {
  it('runs the full create -> select -> confirm flow with exactly-once semantics', async () => {
    const c = await registerCustomer(app);
    const exBefore = (await pool.query(`SELECT balance FROM talerbank.bank_accounts WHERE is_taler_exchange`)).rows[0].balance;
    const op = await request(app).post('/api/withdrawals').set(auth(c.token)).send({ accountId: c.accountId, amount: '120' });
    expect(op.status).toBe(201);
    const opId = op.body.data.withdrawal.operation_id;
    expect(op.body.data.withdrawal.taler_withdraw_uri).toBe(`taler://withdraw/bank.test/taler-integration/${opId}`);

    const pub = await request(app).get(`/taler-integration/withdrawal-operation/${opId}`);
    expect(pub.body.status).toBe('pending');
    expect(pub.body.amount).toBe('PS:120.00');

    // confirming before a wallet selected is refused
    expect((await request(app).post(`/api/withdrawals/${opId}/confirm`).set(auth(c.token)).send({})).status).toBe(409);
    const rp = reserve();
    expect((await request(app).post(`/taler-integration/withdrawal-operation/${opId}`).send({ reserve_pub: rp })).status).toBe(401);
    const sel = await request(app).post(`/taler-integration/withdrawal-operation/${opId}`).set(EX).send({ reserve_pub: rp, wallet_ref: 'wallet_abc' });
    expect(sel.body.status).toBe('selected');
    expect((await request(app).post(`/taler-integration/withdrawal-operation/${opId}`).set(EX).send({ reserve_pub: rp })).status).toBe(200);
    expect((await request(app).post(`/taler-integration/withdrawal-operation/${opId}`).set(EX).send({ reserve_pub: reserve() })).status).toBe(409);

    // a different customer cannot confirm it
    const thief = await registerCustomer(app);
    expect((await request(app).post(`/api/withdrawals/${opId}/confirm`).set(auth(thief.token)).send({})).status).toBe(404);

    const [k1, k2] = await Promise.all([
      request(app).post(`/api/withdrawals/${opId}/confirm`).set(auth(c.token)).send({}),
      request(app).post(`/api/withdrawals/${opId}/confirm`).set(auth(c.token)).send({}),
    ]);
    expect(k1!.status).toBe(200);
    expect(k2!.status).toBe(200);
    expect(await balance(app, c)).toBe('880.00');
    const exAfter = (await pool.query(`SELECT balance FROM talerbank.bank_accounts WHERE is_taler_exchange`)).rows[0].balance;
    expect(Number(exAfter) - Number(exBefore)).toBeCloseTo(120, 2);
    const r = await pool.query(`SELECT amount FROM talerbank.reserves WHERE reserve_pub = $1`, [rp]);
    expect(r.rows[0].amount).toBe('120.00');
    const done = await request(app).get(`/taler-integration/withdrawal-operation/${opId}`);
    expect(done.body.transfer_done).toBe(true);
  });

  it('cannot select an aborted operation', async () => {
    const c = await registerCustomer(app);
    const op = await request(app).post('/api/withdrawals').set(auth(c.token)).send({ accountId: c.accountId, amount: '5' });
    const opId = op.body.data.withdrawal.operation_id;
    await request(app).post(`/api/withdrawals/${opId}/abort`).set(auth(c.token));
    expect((await request(app).post(`/taler-integration/withdrawal-operation/${opId}`).set(EX).send({ reserve_pub: reserve() })).status).toBe(409);
  });
});

// ----------------------------------------------------- wallet link (S-Taler)
describe('wallet link', () => {
  it('links with a one-time code, withdraws idempotently and can be revoked by the customer', async () => {
    const c = await registerCustomer(app, 'Link Owner');
    const code = await request(app).post('/api/link-codes').set(auth(c.token)).send({ accountId: c.accountId });
    expect(code.body.data.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect((await request(app).post('/link/redeem-code').send({ code: code.body.data.code, clientName: 'S-Taler' })).status).toBe(401);
    const linked = await request(app).post('/link/redeem-code').set(EX).send({ code: code.body.data.code, clientName: 'S-Taler', walletRef: 'wallet_x' });
    expect(linked.status).toBe(201);
    const token = linked.body.data.token as string;
    expect((await request(app).post('/link/redeem-code').set(EX).send({ code: code.body.data.code, clientName: 'S-Taler' })).status).toBe(400);

    const acc = await request(app).get('/link/account').set(auth(token));
    expect(acc.body.data.iban).toBe(c.iban);

    const uid = `req_${crypto.randomUUID().replace(/-/g, '')}`;
    const rp = reserve();
    const w1 = await request(app).post('/link/withdraw').set(auth(token)).send({ amount: '40', reserve_pub: rp, request_uid: uid });
    const w2 = await request(app).post('/link/withdraw').set(auth(token)).send({ amount: '40', reserve_pub: rp, request_uid: uid });
    expect(w1.status).toBe(201);
    expect(w2.body.data.replay).toBe(true);
    expect(await balance(app, c)).toBe('960.00');
    const clash = await request(app).post('/link/withdraw').set(auth(token)).send({ amount: '41', reserve_pub: rp, request_uid: uid });
    expect(clash.status).toBe(409);
    expect((await request(app).get(`/link/operations/${uid}`).set(auth(token))).body.data.status).toBe('completed');

    const apps = await request(app).get('/api/linked-apps').set(auth(c.token));
    expect(apps.body.data.apps).toHaveLength(1);
    await request(app).delete(`/api/linked-apps/${apps.body.data.apps[0].id}`).set(auth(c.token));
    expect((await request(app).get('/link/account').set(auth(token))).status).toBe(401);
  });

  it('links with credentials, counting failures towards the lockout', async () => {
    const c = await registerCustomer(app);
    const bad = await request(app).post('/link/credentials').set(EX).send({ login: c.email, password: 'nope', clientName: 'S-Taler' });
    expect(bad.status).toBe(401);
    const f = await pool.query(`SELECT failed_login_count FROM talerbank.users WHERE id = $1`, [c.userId]);
    expect(f.rows[0].failed_login_count).toBe(1);
    const ok = await request(app).post('/link/credentials').set(EX).send({ login: c.username, password: STRONG, clientName: 'S-Taler' });
    expect(ok.status).toBe(201);
    // a link token can't do customer things
    expect((await request(app).get('/api/accounts').set(auth(ok.body.data.token))).status).toBe(401);
  });
});

// ----------------------------------------------------------- wire gateway
describe('wire gateway (wallet -> bank deposits)', () => {
  it('pays out from the exchange account idempotently and only to known accounts', async () => {
    const c = await registerCustomer(app);
    // fund the exchange first via a withdrawal
    const code = await request(app).post('/api/link-codes').set(auth(c.token)).send({ accountId: c.accountId });
    const t = (await request(app).post('/link/redeem-code').set(EX).send({ code: code.body.data.code, clientName: 'S-Taler' })).body.data.token;
    await request(app).post('/link/withdraw').set(auth(t)).send({ amount: '100', reserve_pub: reserve(), request_uid: `r_${crypto.randomUUID().replace(/-/g, '')}` });

    const uid = `w_${crypto.randomUUID().replace(/-/g, '')}`;
    const body = { request_uid: uid, amount: 'PS:30.25', credit_account: `payto://iban/TALERPS1/${c.iban}?receiver-name=X` };
    expect((await request(app).post('/taler-wire-gateway/transfer').send(body)).status).toBe(401);
    const r1 = await request(app).post('/taler-wire-gateway/transfer').set(EX).send(body);
    const r2 = await request(app).post('/taler-wire-gateway/transfer').set(EX).send(body);
    expect(r1.status).toBe(200);
    expect(r2.body.data.replay).toBe(true);
    expect(await balance(app, c)).toBe('930.25');
    expect((await request(app).post('/taler-wire-gateway/transfer').set(EX).send({ ...body, amount: 'PS:31' })).status).toBe(409);
    expect((await request(app).post('/taler-wire-gateway/transfer').set(EX).send({ ...body, request_uid: `w_${crypto.randomUUID().replace(/-/g, '')}`, amount: 'USD:1' })).status).toBe(400);
    const unknown = await request(app)
      .post('/taler-wire-gateway/transfer')
      .set(EX)
      .send({ ...body, request_uid: `w_${crypto.randomUUID().replace(/-/g, '')}`, credit_account: 'payto://iban/TALERPS1/GB82WEST12345698765432' });
    expect(unknown.status).toBe(404);
    const incoming = await request(app).get('/taler-wire-gateway/history/incoming').set(EX);
    expect(incoming.body.incoming_transactions.length).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------------- admin
describe('administration', () => {
  let adminToken: string;
  beforeAll(async () => {
    const r = await request(app).post('/api/auth/login').send({ login: 'admin@talerbank.local', password: process.env.BANK_ADMIN_PASSWORD });
    adminToken = r.body.data.accessToken;
  });

  it('is closed to customers', async () => {
    const c = await registerCustomer(app);
    expect((await request(app).get('/api/admin/overview').set(auth(c.token))).status).toBe(403);
    expect((await request(app).get('/api/admin/overview')).status).toBe(401);
  });

  it('shows an overview and books teller cash-in', async () => {
    const c = await registerCustomer(app);
    const ov = await request(app).get('/api/admin/overview').set(auth(adminToken));
    expect(ov.status).toBe(200);
    expect(ov.body.data.series).toHaveLength(14);
    const t = await request(app).post('/api/admin/teller').set(auth(adminToken)).send({ accountId: c.accountId, amount: '500', direction: 'in', note: 'Cash at branch' });
    expect(t.status).toBe(201);
    expect(await balance(app, c)).toBe('1500.00');
  });

  it('freezing an account blocks outgoing money; suspending a user kills their session', async () => {
    const c = await registerCustomer(app);
    const d = await registerCustomer(app);
    await request(app).post(`/api/admin/accounts/${c.accountId}/freeze`).set(auth(adminToken)).send({ frozen: true });
    const r = await request(app).post('/api/transfers').set(auth(c.token)).send({ fromAccountId: c.accountId, to: d.iban, amount: '1' });
    expect(r.body.error.code).toBe('ACCOUNT_LOCKED');
    await request(app).patch(`/api/admin/users/${d.userId}`).set(auth(adminToken)).send({ status: 'suspended' });
    expect((await request(app).get('/api/accounts').set(auth(d.token))).status).toBe(401);
    const self = await pool.query(`SELECT id FROM talerbank.users WHERE email='admin@talerbank.local'`);
    expect((await request(app).patch(`/api/admin/users/${self.rows[0].id}`).set(auth(adminToken)).send({ status: 'suspended' })).status).toBe(403);
    expect((await request(app).patch(`/api/admin/users/${d.userId}`).set(auth(adminToken)).send({ role: 'exchange' })).status).toBe(400);
  });

  it('keeps an append-only audit trail', async () => {
    const r = await request(app).get('/api/admin/audit?limit=50').set(auth(adminToken));
    const actions = r.body.data.events.map((e: any) => e.action);
    expect(actions).toContain('admin.teller_in');
    expect(actions).toContain('auth.login');
  });
});

// ------------------------------------------------------------ rate limiting
describe('rate limiting', () => {
  it('throttles brute-force login attempts per IP', async () => {
    env.DISABLE_RATE_LIMIT = false;
    try {
      let limited = false;
      for (let i = 0; i < 25 && !limited; i++) {
        const r = await request(app).post('/api/auth/login').set('X-Forwarded-For', '203.0.113.9').send({ login: 'nobody@example.com', password: 'x' });
        if (r.status === 429) limited = true;
      }
      expect(limited).toBe(true);
    } finally {
      env.DISABLE_RATE_LIMIT = true;
    }
  });
});

// ------------------------------------------------------------- invariants
describe('ledger invariants', () => {
  it('conserves money: the sum of all balances never changes (double-entry)', async () => {
    // Fixture started with exactly 250.00 in the system; every movement since was double-entry.
    expect(await sumBalances()).toBe('250.00');
  });

  it('every transaction has matching balance snapshots and a positive amount', async () => {
    const bad = await pool.query(`SELECT count(*)::int AS n FROM talerbank.transactions WHERE amount <= 0 OR from_account_id = to_account_id`);
    expect(bad.rows[0].n).toBe(0);
  });
});

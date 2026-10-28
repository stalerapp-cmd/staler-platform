import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { bootstrap } from '../src/db/bootstrap.js';
import { pool } from '../src/lib/db.js';
import { reconcilePending } from '../src/modules/bank.js';
import { newReserveKeypair } from '../src/lib/reserve.js';
import { STALER_PORT, WEBHOOK_SECRET } from './env.js';
import {
  auth,
  bankApi,
  bankBalance,
  bankCustomer,
  lastCode,
  login,
  startBank,
  stopBank,
  STRONG,
  uniq,
  walletBalance,
  walletUser,
  type BankCustomer,
  type WalletUser,
} from './harness.js';

let app: Express;
let server: Server;
/** A wallet funded the real way — 1000 PS moved in from TalerBank — used to fund other test wallets. */
let funder: WalletUser;
const LEGACY_USER = 'old.user@example.com';
const LEGACY_PASS = 'OldWallet!Pass1';
const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);
const idem = () => `k_${crypto.randomUUID()}`;
const until = async (fn: () => Promise<boolean>, ms = 15_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};

beforeAll(async () => {
  await migrate();
  await migrate();
  await bootstrap();
  await bootstrap();
  app = createApp();
  server = app.listen(STALER_PORT);
  await startBank();
  funder = await walletUser(app, 'Test Funder');
  const bc = await bankCustomer('Test Funder');
  const code = await bankApi.post('/api/link-codes', { accountId: bc.accountId }, bc.token);
  await request(app).post('/api/bank/link').set(auth(funder.token)).send({ code: code.body.data.code });
  const w = await request(app).post('/api/bank/withdraw').set(auth(funder.token)).send({ amount: '1000' });
  if (w.status !== 201) throw new Error(`funding failed: ${JSON.stringify(w.body)}`);
});

afterAll(async () => {
  await stopBank();
  server?.close();
  await pool.end();
});

// ===================================================================== upgrade
describe('upgrade of the existing S-Taler database', () => {
  it('erases stored bank passwords and plaintext passwords left by the old backend', async () => {
    const ba = await q(`SELECT bank_password_enc, status FROM public.bank_accounts WHERE bank_username = 'olduser'`);
    expect(ba.rows[0]).toEqual({ bank_password_enc: null, status: 'inactive' });
    const anyPw = await q(`SELECT count(*)::int AS n FROM public.bank_accounts WHERE bank_password_enc IS NOT NULL`);
    expect(anyPw.rows[0].n).toBe(0);
    const pu = await q(`SELECT pending_changes FROM public.profile_update_verifications`);
    expect(JSON.stringify(pu.rows)).not.toContain('MyPlainTextPassword1!');
  });

  it('re-encrypts plaintext reserve keys and gives wallet-less users a wallet', async () => {
    const r = await q(`SELECT reserve_priv FROM public.reserves WHERE reserve_pub LIKE 'ABCDEF%'`);
    expect(r.rows[0].reserve_priv).toMatch(/^gcm1:/);
    const w = await q(`SELECT count(*)::int AS n FROM public.wallets w JOIN public.users u ON u.id = w.user_id WHERE u.email = 'old.admin@example.com'`);
    expect(w.rows[0].n).toBe(1);
  });

  it('keeps balances, derives escrow for old orders and locks the tables behind RLS', async () => {
    const w = await q(`SELECT balance FROM public.wallets WHERE wallet_id = 'wallet_old12345'`);
    expect(w.rows[0].balance).toBe('300.00');
    const o = await q(`SELECT escrow_status FROM public.orders WHERE id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'`);
    expect(o.rows[0].escrow_status).toBe('held');
    const rls = await q(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('users','wallets','transactions') AND NOT rowsecurity`);
    expect(rls.rows[0].n).toBe(0);
    await expect(q(`UPDATE public.wallets SET balance = -1 WHERE wallet_id = 'wallet_old12345'`)).rejects.toMatchObject({ code: '23514' });
  });

  it('lets legacy users sign in (bcrypt) and upgrades their hash; old messages stay readable', async () => {
    const token = await login(app, LEGACY_USER, LEGACY_PASS);
    const h = await q(`SELECT password_hash FROM public.users WHERE email = $1`, [LEGACY_USER]);
    expect(h.rows[0].password_hash).toMatch(/^\$argon2id\$/);
    const msgs = await request(app).get('/api/messages/conversations/99999999-9999-4999-8999-999999999999/messages').set(auth(token));
    expect(msgs.body.data.messages[0].content).toBe('Hello from the old system');
  });
});

// ======================================================================= http
describe('http & token hardening', () => {
  it('has strict headers, JSON 404s and no stack traces', async () => {
    const r = await request(app).get('/api/nope');
    expect(r.status).toBe(404);
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['x-powered-by']).toBeUndefined();
    const bad = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad');
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toMatch(/node_modules|\.ts:/);
  });

  it('rejects a TalerBank access token at S-Taler (no cross-app token confusion)', async () => {
    const c = await bankCustomer();
    const r = await request(app).get('/api/wallet').set(auth(c.token));
    expect(r.status).toBe(401);
  });
});

// =============================================================== registration
describe('registration', () => {
  it('cannot self-register as admin or exchange (old privilege-escalation hole)', async () => {
    const email = `${uniq()}@x.com`;
    const a = await request(app).post('/api/auth/register').send({ fullName: 'Evil One', email, password: STRONG, role: 'admin' });
    expect(a.status).toBe(400);
    const b = await request(app).post('/api/auth/register').send({ fullName: 'Evil One', email, password: STRONG, accountType: 'admin' });
    expect(b.status).toBe(400);
  });

  it('creates merchants and users with strong, unguessable wallet ids', async () => {
    const m = await walletUser(app, 'New Merchant', 'merchant');
    expect(m.walletId).toMatch(/^wallet_[a-z2-9]{12}$/);
    const me = await request(app).get('/api/auth/me').set(auth(m.token));
    expect(me.body.data.user.role).toBe('merchant');
  });

  it('tells a pending user to verify (only with the right password)', async () => {
    const email = `${uniq()}@x.com`;
    await request(app).post('/api/auth/register').send({ fullName: 'Pending Person', email, password: STRONG });
    expect((await request(app).post('/api/auth/login').send({ email, password: 'Wrong!Pass123' })).status).toBe(401);
    const r = await request(app).post('/api/auth/login').send({ email, password: STRONG });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('PENDING_VERIFICATION');
  });
});

// ====================================================================== wallet
describe('wallet transfers', () => {
  let rich: WalletUser;
  beforeAll(async () => {
    rich = { email: LEGACY_USER, token: await login(app, LEGACY_USER, LEGACY_PASS), cookie: '', userId: '', walletId: 'wallet_old12345' };
  });

  it('sends money by wallet id and by e-mail, with idempotency', async () => {
    const b = await walletUser(app, 'Receiver Person');
    const key = idem();
    const body = { to: b.walletId, amount: '10.25', description: 'Hi' };
    const r1 = await request(app).post('/api/wallet/transfer').set(auth(rich.token)).set('Idempotency-Key', key).send(body);
    const r2 = await request(app).post('/api/wallet/transfer').set(auth(rich.token)).set('Idempotency-Key', key).send(body);
    expect(r1.status).toBe(201);
    expect(r2.body.data.reference).toBe(r1.body.data.reference);
    expect(await walletBalance(app, b)).toBe('10.25');
    const byMail = await request(app).post('/api/wallet/transfer').set(auth(rich.token)).send({ to: b.email, amount: 1 });
    expect(byMail.status).toBe(201);
    expect(byMail.body.data.to.name).toBe('Receiver P.');
    const lookup = await request(app).get(`/api/wallet/lookup?to=${b.walletId}`).set(auth(rich.token));
    expect(lookup.body.data.name).toBe('Receiver P.');
  });

  it('refuses self-transfers, bad amounts and unknown recipients', async () => {
    expect((await request(app).post('/api/wallet/transfer').set(auth(rich.token)).send({ to: rich.walletId, amount: '1' })).status).toBe(400);
    for (const amount of ['0', '-1', '1.001', 'abc', '1e2', null]) {
      expect((await request(app).post('/api/wallet/transfer').set(auth(rich.token)).send({ to: 'wallet_nobody123', amount })).status).toBe(400);
    }
    expect((await request(app).post('/api/wallet/transfer').set(auth(rich.token)).send({ to: 'wallet_nobody123', amount: '1' })).status).toBe(404);
  });

  it('cannot be double-spent by 30 parallel requests', async () => {
    const a = await walletUser(app, 'Spender Person');
    const sink = await walletUser(app, 'Sink Person');
    await request(app).post('/api/wallet/transfer').set(auth(rich.token)).send({ to: a.walletId, amount: '50' });
    const res = await Promise.all(
      Array.from({ length: 30 }, () => request(app).post('/api/wallet/transfer').set(auth(a.token)).send({ to: sink.walletId, amount: '10' })),
    );
    expect(res.filter((r) => r.status === 201)).toHaveLength(5);
    expect(await walletBalance(app, a)).toBe('0.00');
    expect(await walletBalance(app, sink)).toBe('50.00');
  });

  it('frozen wallets cannot send', async () => {
    const a = await walletUser(app, 'Frozen Person');
    await request(app).post('/api/wallet/transfer').set(auth(rich.token)).send({ to: a.walletId, amount: '5' });
    const sup = await login(app, 'super@staler.test', 'Sup3r!Admin#Pass');
    await request(app).post(`/api/admin/wallets/${a.walletId}/freeze`).set(auth(sup)).send({ frozen: true });
    const r = await request(app).post('/api/wallet/transfer').set(auth(a.token)).send({ to: rich.walletId, amount: '1' });
    expect(r.body.error.code).toBe('WALLET_FROZEN');
  });
});

// ============================================================ exchange vouchers
describe('cash vouchers (any personal or business account; replaces the unauthenticated /exchange/claim)', () => {
  it('escrows, claims once, blocks self-claim and refunds on cancel', async () => {
    const sup = await login(app, 'super@staler.test', 'Sup3r!Admin#Pass');
    const email = `${uniq('ex')}@x.com`;
    await request(app).post('/api/admin/users').set(auth(sup)).send({ fullName: 'Cash Agent', email, password: STRONG, role: 'user' });
    const agent = await login(app, email, STRONG);
    const legacy = funder.token;
    const me = await request(app).get('/api/auth/me').set(auth(agent));
    await request(app).post('/api/wallet/transfer').set(auth(legacy)).send({ to: me.body.data.user.wallet_id, amount: '100' });

    const v = await request(app).post('/api/exchange/vouchers').set(auth(agent)).send({ amount: '30', description: 'Cash out' });
    expect(v.status).toBe(201);
    const uri: string = v.body.data.voucher.uri;
    expect(uri).toMatch(/^taler:\/\/exchange-claim\?v=/);
    expect((await request(app).get('/api/wallet').set(auth(agent))).body.data.wallet.balance).toBe('70.00');

    // any account can hand out cash value, but never more than it holds; admins can't mint money
    const u = await walletUser(app, 'Voucher Taker');
    expect((await request(app).post('/api/exchange/vouchers').set(auth(u.token)).send({ amount: '1' })).status).toBe(409);
    expect((await request(app).post('/api/exchange/vouchers').set(auth(sup)).send({ amount: '1' })).status).toBe(403);
    // wrong secret
    const forged = uri.replace(/\.[A-Za-z0-9_-]{32}$/, '.' + 'A'.repeat(32));
    expect((await request(app).post('/api/exchange/claim').set(auth(u.token)).send({ voucher: forged })).status).toBe(404);
    expect((await request(app).post('/api/exchange/claim').set(auth(agent)).send({ voucher: uri })).status).toBe(403);
    const [c1, c2] = await Promise.all([
      request(app).post('/api/exchange/claim').set(auth(u.token)).send({ voucher: uri }),
      request(app).post('/api/exchange/claim').set(auth(u.token)).send({ voucher: uri }),
    ]);
    expect([c1!.status, c2!.status].sort()).toEqual([200, 409]);
    expect(await walletBalance(app, u)).toBe('30.00');

    const v2 = await request(app).post('/api/exchange/vouchers').set(auth(agent)).send({ amount: '20' });
    await request(app).delete(`/api/exchange/vouchers/${v2.body.data.voucher.id}`).set(auth(agent));
    expect((await request(app).get('/api/wallet').set(auth(agent))).body.data.wallet.balance).toBe('70.00');
    expect((await request(app).post('/api/exchange/claim').set(auth(u.token)).send({ voucher: v2.body.data.voucher.uri })).status).toBe(409);
  });
});

// ================================================================= marketplace
describe('marketplace', () => {
  it('never exposes private digital file locations publicly', async () => {
    const list = await request(app).get('/api/store/products');
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain('secret-ebook.pdf');
    const one = await request(app).get('/api/store/products/dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    expect(one.body.data.product.digital_file_url).toBeUndefined();
  });

  it('holds payment in escrow until the buyer confirms; cancel refunds and restocks', async () => {
    const buyer = await walletUser(app, 'Atlas Buyer');
    const legacy = funder.token;
    await request(app).post('/api/wallet/transfer').set(auth(legacy)).send({ to: buyer.walletId, amount: '100' });
    const merchantBefore = (await q(`SELECT balance FROM public.wallets WHERE wallet_id = 'merchant_1700000000000_abcdefghi'`)).rows[0].balance;

    const co = await request(app)
      .post('/api/store/checkout')
      .set(auth(buyer.token))
      .set('Idempotency-Key', idem())
      .send({ items: [{ productId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', quantity: 2 }], address: 'Rafidia St, Nablus' });
    expect(co.status).toBe(201);
    expect(co.body.data.total).toBe('80.00');
    expect(await walletBalance(app, buyer)).toBe('20.00');
    const orderId = co.body.data.orders[0].id;
    expect((await q(`SELECT balance FROM public.wallets WHERE wallet_id = 'merchant_1700000000000_abcdefghi'`)).rows[0].balance).toBe(merchantBefore);
    expect((await q(`SELECT stock FROM public.products WHERE id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'`)).rows[0].stock).toBe(3);

    const merchant = await login(app, 'old.merchant@example.com', LEGACY_PASS);
    expect((await request(app).post(`/api/merchant/orders/${orderId}/ship`).set(auth(merchant))).status).toBe(200);
    expect((await request(app).post(`/api/store/orders/${orderId}/cancel`).set(auth(buyer.token))).status).toBe(409); // shipped
    const [k1, k2] = await Promise.all([
      request(app).post(`/api/store/orders/${orderId}/confirm`).set(auth(buyer.token)),
      request(app).post(`/api/store/orders/${orderId}/confirm`).set(auth(buyer.token)),
    ]);
    expect([k1!.status, k2!.status].sort()).toEqual([200, 409]);
    const after = (await q(`SELECT balance FROM public.wallets WHERE wallet_id = 'merchant_1700000000000_abcdefghi'`)).rows[0].balance;
    expect(Number(after) - Number(merchantBefore)).toBeCloseTo(80, 2);

    // second order cancelled by the buyer before shipping -> refund + restock
    await request(app).post('/api/wallet/transfer').set(auth(legacy)).send({ to: buyer.walletId, amount: '40' });
    const co2 = await request(app).post('/api/store/checkout').set(auth(buyer.token)).send({ items: [{ productId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', quantity: 1 }], fulfillment: 'pickup' });
    expect(co2.status, JSON.stringify(co2.body)).toBe(201);
    const o2 = co2.body.data.orders[0].id;
    expect((await request(app).post(`/api/store/orders/${o2}/cancel`).set(auth(buyer.token))).status).toBe(200);
    expect(await walletBalance(app, buyer)).toBe('60.00');
    expect((await q(`SELECT stock FROM public.products WHERE id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'`)).rows[0].stock).toBe(3);
  });

  it('pays digital goods instantly and lets only the buyer download', async () => {
    const m = await walletUser(app, 'Digital Seller', 'merchant');
    await request(app).post('/api/merchant/profile').set(auth(m.token)).send({ storeName: 'Pixel Shop' });
    const up = await request(app)
      .post('/api/merchant/uploads/digital')
      .set(auth(m.token))
      .attach('file', Buffer.from('%PDF-1.4\n%secret content\n'), 'guide.pdf');
    expect(up.status).toBe(201);
    const exe = await request(app).post('/api/merchant/uploads/digital').set(auth(m.token)).attach('file', Buffer.from('MZ\x90\x00binary'), 'tool.pdf');
    expect(exe.status).toBe(400);
    const p = await request(app).post('/api/merchant/products').set(auth(m.token)).send({ name: 'PDF Guide', price: '12.5', isDigital: true, digitalFileRef: up.body.data.ref });
    expect(p.status).toBe(201);

    const buyer = await walletUser(app, 'Guide Buyer');
    const legacy = funder.token;
    await request(app).post('/api/wallet/transfer').set(auth(legacy)).send({ to: buyer.walletId, amount: '20' });
    const co = await request(app).post('/api/store/checkout').set(auth(buyer.token)).send({ items: [{ productId: p.body.data.product.id, quantity: 1 }] });
    expect(co.body.data.orders[0].status).toBe('completed');
    expect(await walletBalance(app, m)).toBe('12.50');

    const order = (await request(app).get('/api/store/orders').set(auth(buyer.token))).body.data.orders[0];
    expect(order.items[0].licence_code).toMatch(/^ST-[0-9A-F]{4}-[0-9A-F]{4}$/);
    // the old direct-download route and raw storage links are gone
    expect((await request(app).get(`/api/store/orders/${order.id}/items/${order.items[0].id}/download`).set(auth(buyer.token))).status).toBe(404);
    const ticket = await request(app).post(`/api/store/orders/${order.id}/items/${order.items[0].id}/ticket`).set(auth(buyer.token)).send({});
    expect(ticket.status).toBe(200);
    expect(ticket.body.data.url).toMatch(/^\/api\/store\/file\/[A-Za-z0-9_-]{40,}$/);
    const dl = await request(app).get(ticket.body.data.url).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toContain(order.items[0].licence_code);
    // single use: a forwarded link is dead
    expect((await request(app).get(ticket.body.data.url)).status).toBe(404);
    const thief = await walletUser(app, 'Not Buyer');
    expect((await request(app).post(`/api/store/orders/${order.id}/items/${order.items[0].id}/ticket`).set(auth(thief.token)).send({})).status).toBe(404);
    // the seller can trace a leaked copy back to the buyer
    const lic = await request(app).get(`/api/merchant/licences/${order.items[0].licence_code}`).set(auth(m.token));
    expect(lic.body.data.licence.buyer_email).toBe(buyer.email);

    // merchants cannot buy from themselves or edit other stores' products
    expect((await request(app).post('/api/store/checkout').set(auth(m.token)).send({ items: [{ productId: p.body.data.product.id, quantity: 1 }] })).status).toBe(400);
    const other = await login(app, 'old.merchant@example.com', LEGACY_PASS);
    const hijack = await request(app).put(`/api/merchant/products/${p.body.data.product.id}`).set(auth(other)).send({ name: 'Hacked', price: '0.01' });
    expect(hijack.status).toBe(404);
    expect((await request(app).delete(`/api/merchant/products/${p.body.data.product.id}`).set(auth(other))).status).toBe(404);
  });

  it('deposit orders: deposit held, balance paid, handover code settles, disputes freeze', async () => {
    const m = await walletUser(app, 'Deposit Seller', 'merchant');
    const st = await request(app).post('/api/merchant/stores').set(auth(m.token)).send({ storeName: 'Olive Wood', category: 'crafts', city: 'Bethlehem' });
    expect(st.status).toBe(201);
    const br = await request(app).post('/api/merchant/stores').set(auth(m.token)).send({ storeName: 'Olive Wood', parentId: st.body.data.store.id, branchName: 'Ramallah' });
    expect(br.status).toBe(201);
    const p = await request(app)
      .post('/api/merchant/products')
      .set(auth(m.token))
      .set('x-store-id', br.body.data.store.id)
      .send({ name: 'Carved Table', price: '100', stock: 3, depositPercent: 20 });
    expect(p.status).toBe(201);
    const page = await request(app).get(`/api/store/s/${st.body.data.store.slug}`);
    expect(page.body.data.branches).toHaveLength(2);

    const buyer = await walletUser(app, 'Table Buyer');
    await request(app).post('/api/wallet/transfer').set(auth(funder.token)).send({ to: buyer.walletId, amount: '150' });
    const noAddr = await request(app).post('/api/store/checkout').set(auth(buyer.token)).send({ items: [{ productId: p.body.data.product.id, quantity: 1 }] });
    expect(noAddr.status).toBe(400);
    const co = await request(app)
      .post('/api/store/checkout')
      .set(auth(buyer.token))
      .send({ items: [{ productId: p.body.data.product.id, quantity: 1 }], address: 'Al-Irsal St, Ramallah', phone: '0599000000' });
    expect(co.status, JSON.stringify(co.body)).toBe(201);
    expect(co.body.data.total).toBe('20.00');
    const id = co.body.data.orders[0].id;
    let o = (await request(app).get(`/api/store/orders/${id}`).set(auth(buyer.token))).body.data.order;
    expect(o.balance_due).toBe('80.00');
    expect(o.handover_code).toMatch(/^\d{6}$/);
    // the store never sees the handover code
    const mo = (await request(app).get('/api/merchant/orders?all=1').set(auth(m.token))).body.data.orders.find((x: any) => x.id === id);
    expect(mo.handover_code).toBeUndefined();

    expect((await request(app).post(`/api/merchant/orders/${id}/accept`).set(auth(m.token)).send({})).status).toBe(200);
    expect((await request(app).post(`/api/merchant/orders/${id}/ship`).set(auth(m.token)).send({ lat: 31.9, lng: 35.2 })).status).toBe(200);
    expect((await request(app).post(`/api/merchant/orders/${id}/track`).set(auth(m.token)).send({ lat: 31.91, lng: 35.21, note: 'Qalandia' })).status).toBe(200);
    // confirming isn't possible while the balance is unpaid
    expect((await request(app).post(`/api/store/orders/${id}/confirm`).set(auth(buyer.token))).status).toBe(409);
    expect((await request(app).post(`/api/store/orders/${id}/pay-balance`).set(auth(buyer.token)).send({})).status).toBe(200);
    expect(await walletBalance(app, buyer)).toBe('50.00');
    // wrong code is rejected, the right code settles the money with the store
    expect((await request(app).post(`/api/merchant/orders/${id}/deliver`).set(auth(m.token)).send({ code: o.handover_code === '000000' ? '111111' : '000000' })).status).toBe(400);
    expect((await request(app).post(`/api/merchant/orders/${id}/deliver`).set(auth(m.token)).send({ code: o.handover_code })).status).toBe(200);
    expect(await walletBalance(app, m)).toBe('100.00');
    o = (await request(app).get(`/api/store/orders/${id}`).set(auth(buyer.token))).body.data.order;
    expect(o.status).toBe('completed');
    expect(o.events.map((e: any) => e.kind)).toEqual(expect.arrayContaining(['placed', 'accepted', 'shipped', 'location', 'balance_paid', 'delivered', 'released']));

    // a disputed order is frozen until an admin decides
    await request(app).post('/api/wallet/transfer').set(auth(funder.token)).send({ to: buyer.walletId, amount: '50' });
    const co2 = await request(app).post('/api/store/checkout').set(auth(buyer.token)).send({ items: [{ productId: p.body.data.product.id, quantity: 1 }], fulfillment: 'pickup' });
    const id2 = co2.body.data.orders[0].id;
    expect((await request(app).post(`/api/store/orders/${id2}/dispute`).set(auth(buyer.token)).send({ reason: 'Store is not answering' })).status).toBe(200);
    const code2 = (await request(app).get(`/api/store/orders/${id2}`).set(auth(buyer.token))).body.data.order.handover_code;
    expect((await request(app).post(`/api/merchant/orders/${id2}/deliver`).set(auth(m.token)).send({ code: code2, cashBalance: true })).status).toBe(409);
    const admin = await login(app, 'super@staler.test', 'Sup3r!Admin#Pass');
    expect((await request(app).post(`/api/admin/orders/${id2}/resolve`).set(auth(admin)).send({ outcome: 'refund', note: 'Store unreachable' })).status).toBe(200);
    expect(await walletBalance(app, buyer)).toBe('100.00');
  });

  it('sells exactly the stock under concurrent checkouts', async () => {
    const m = await walletUser(app, 'Scarce Seller', 'merchant');
    await request(app).post('/api/merchant/profile').set(auth(m.token)).send({ storeName: 'Scarce' });
    const p = await request(app).post('/api/merchant/products').set(auth(m.token)).send({ name: 'Limited Mug', price: '1', stock: 4 });
    const legacy = funder.token;
    const buyers = await Promise.all(Array.from({ length: 8 }, (_, i) => walletUser(app, `Mug Buyer ${'abcdefgh'[i]}`)));
    for (const b of buyers) await request(app).post('/api/wallet/transfer').set(auth(legacy)).send({ to: b.walletId, amount: '2' });
    const res = await Promise.all(
      buyers.map((b) => request(app).post('/api/store/checkout').set(auth(b.token)).send({ items: [{ productId: p.body.data.product.id, quantity: 1 }], address: 'Old City, Nablus' })),
    );
    expect(res.filter((r) => r.status === 201)).toHaveLength(4);
    expect((await q(`SELECT stock FROM public.products WHERE id = $1`, [p.body.data.product.id])).rows[0].stock).toBe(0);
  });
});

// ====================================================== TalerBank integration
describe('TalerBank integration (real bank process)', () => {
  let u: WalletUser;
  let c: BankCustomer;
  beforeAll(async () => {
    u = await walletUser(app, 'Linked Person');
    c = await bankCustomer('Linked Person');
  });

  it('links with a one-time code from the bank — no password ever reaches S-Taler', async () => {
    const code = await bankApi.post('/api/link-codes', { accountId: c.accountId }, c.token);
    const r = await request(app).post('/api/bank/link').set(auth(u.token)).send({ code: code.body.data.code });
    expect(r.status).toBe(201);
    expect(r.body.data.iban).toBe(c.iban);
    const row = await q(`SELECT bank_token_enc FROM public.bank_accounts WHERE user_id = $1 AND status = 'active'`, [u.userId]);
    expect(row.rows[0].bank_token_enc).toMatch(/^gcm1:/);
    const bal = await request(app).get('/api/bank/link/balance').set(auth(u.token));
    expect(bal.body.data.balance).toBe('1000.00');
  });

  it('moves money bank -> wallet atomically and idempotently', async () => {
    const key = idem();
    const r1 = await request(app).post('/api/bank/withdraw').set(auth(u.token)).set('Idempotency-Key', key).send({ amount: '200' });
    const r2 = await request(app).post('/api/bank/withdraw').set(auth(u.token)).set('Idempotency-Key', key).send({ amount: '200' });
    expect(r1.status).toBe(201);
    expect(r2.body.data.operationId).toBe(r1.body.data.operationId);
    expect(await walletBalance(app, u)).toBe('200.00');
    expect(await bankBalance(c)).toBe('800.00');
    const res = await q(`SELECT reserve_priv FROM public.reserves r JOIN public.wallets w ON w.id = r.wallet_id WHERE w.wallet_id = $1`, [u.walletId]);
    expect(res.rows[0].reserve_priv).toMatch(/^gcm1:/);
  });

  it('locks the bank link: changing or removing it needs a fresh e-mailed code', async () => {
    const other = await bankCustomer('Linked Person Two');
    const code2 = await bankApi.post('/api/link-codes', { accountId: other.accountId }, other.token);
    // a stolen session alone can't point the wallet at another account, or unlink it
    expect((await request(app).post('/api/bank/link').set(auth(u.token)).send({ code: code2.body.data.code })).status).toBe(403);
    expect((await request(app).delete('/api/bank/link').set(auth(u.token)).send({})).status).toBe(403);
    expect((await request(app).post('/api/bank/link/change-code').set(auth(u.token))).status).toBe(200);
    expect((await request(app).delete('/api/bank/link').set(auth(u.token)).send({ changeCode: '000000' === lastCode(u.email) ? '111111' : '000000' })).status).toBe(400);
    expect((await request(app).get('/api/bank/link').set(auth(u.token))).body.data.linked).toBe(true);
  });

  it('moves money wallet -> bank, refusing more than the wallet holds', async () => {
    const tooMuch = await request(app).post('/api/bank/deposit').set(auth(u.token)).send({ amount: '200.01' });
    expect(tooMuch.status).toBe(409);
    const r = await request(app).post('/api/bank/deposit').set(auth(u.token)).set('Idempotency-Key', idem()).send({ amount: '50' });
    expect(r.status).toBe(201);
    expect(await walletBalance(app, u)).toBe('150.00');
    expect(await bankBalance(c)).toBe('850.00');
    const tx = await request(app).get('/api/wallet/transactions?limit=5').set(auth(u.token));
    expect(tx.body.data.transactions[0]).toMatchObject({ type: 'deposit', status: 'completed', amount: '-50.00' });
  });

  it('runs the QR flow: bank QR -> wallet select -> bank confirm -> signed webhook credits once', async () => {
    const op = await bankApi.post('/api/withdrawals', { accountId: c.accountId, amount: '75' }, c.token);
    const uri: string = op.body.data.withdrawal.taler_withdraw_uri;
    const inspect = await request(app).post('/api/bank/qr/inspect').set(auth(u.token)).send({ uri });
    expect(inspect.body.data).toMatchObject({ amount: '75.00', status: 'pending' });
    const acc = await request(app).post('/api/bank/qr/accept').set(auth(u.token)).send({ uri });
    expect(acc.status).toBe(201);
    // another wallet cannot hijack the same QR
    const other = await walletUser(app, 'QR Thief');
    expect((await request(app).post('/api/bank/qr/accept').set(auth(other.token)).send({ uri })).status).toBe(409);
    // nothing is credited before the customer confirms in the bank (old code credited immediately)
    expect(await walletBalance(app, u)).toBe('150.00');
    const conf = await bankApi.post(`/api/withdrawals/${op.body.data.withdrawal.operation_id}/confirm`, {}, c.token);
    expect(conf.status).toBe(200);
    expect(await until(async () => (await walletBalance(app, u)) === '225.00')).toBe(true);
    const st = await request(app).get(`/api/bank/qr/${op.body.data.withdrawal.operation_id}`).set(auth(u.token));
    expect(st.body.data.status).toBe('completed');
    expect(await walletBalance(app, u)).toBe('225.00');
  });

  it('rejects unsigned, tampered or replayed webhooks', async () => {
    const body = JSON.stringify({ event: 'withdrawal.confirmed', id: crypto.randomUUID(), created_at: new Date().toISOString(), data: {} });
    const none = await request(app).post('/api/bank/webhook').set('Content-Type', 'application/json').send(body);
    expect(none.status).toBe(403);
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${ts}.${body}`).digest('hex');
    const ok = await request(app).post('/api/bank/webhook').set('Content-Type', 'application/json').set('X-TalerBank-Signature', `t=${ts},v1=${sig}`).send(body);
    expect(ok.status).toBe(200);
    const replay = await request(app).post('/api/bank/webhook').set('Content-Type', 'application/json').set('X-TalerBank-Signature', `t=${ts},v1=${sig}`).send(body);
    expect(replay.body.duplicate).toBe(true);
    const old = Math.floor(Date.now() / 1000 - 3600).toString();
    const oldSig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${old}.${body}`).digest('hex');
    expect((await request(app).post('/api/bank/webhook').set('Content-Type', 'application/json').set('X-TalerBank-Signature', `t=${old},v1=${oldSig}`).send(body)).status).toBe(403);
  });

  it('reconciles operations whose outcome was unknown (crash after the bank call)', async () => {
    // A deposit whose wire transfer never reached the bank: reconciler retries it (idempotent).
    const w = (await q(`SELECT id FROM public.wallets WHERE wallet_id = $1`, [u.walletId])).rows[0];
    const uid = `std_${crypto.randomBytes(12).toString('hex')}`;
    await q(`UPDATE public.wallets SET balance = balance - 5 WHERE id = $1`, [w.id]);
    const op = await q(
      `INSERT INTO public.bank_operations (user_id, wallet_ref, kind, status, amount, request_uid, bank_iban, updated_at)
       VALUES ($1, $2, 'deposit', 'pending', 5, $3, $4, now() - interval '1 minute') RETURNING id`,
      [u.userId, w.id, uid, c.iban],
    );
    await q(`INSERT INTO public.transactions (user_id, wallet_id, transaction_type, amount, status, description, reference) VALUES ($1, $2, 'deposit', -5, 'pending', 'x', $3)`, [
      u.userId,
      u.walletId,
      op.rows[0].id,
    ]);
    // A bank->wallet withdrawal that the bank executed but S-Taler never credited.
    const link = (await q(`SELECT bank_token_enc FROM public.bank_accounts WHERE user_id = $1 AND status = 'active'`, [u.userId])).rows[0];
    const { decrypt } = await import('../src/lib/crypto.js');
    const token = decrypt(link.bank_token_enc, `banklink:${u.userId}`);
    const kp = newReserveKeypair();
    const wuid = `stw_${crypto.randomBytes(12).toString('hex')}`;
    expect((await bankApi.post('/link/withdraw', { amount: '7', reserve_pub: kp.reservePub, request_uid: wuid }, token)).status).toBe(201);
    await q(
      `INSERT INTO public.bank_operations (user_id, wallet_ref, kind, status, amount, request_uid, reserve_pub, updated_at)
       VALUES ($1, $2, 'link_withdraw', 'pending', 7, $3, $4, now() - interval '1 minute')`,
      [u.userId, w.id, wuid, kp.reservePub],
    );
    const before = Number(await walletBalance(app, u));
    const bankBefore = Number(await bankBalance(c));
    await reconcilePending();
    await reconcilePending(); // idempotent
    expect(Number(await walletBalance(app, u))).toBeCloseTo(before + 7, 2);
    expect(Number(await bankBalance(c))).toBeCloseTo(bankBefore + 5, 2);
    const states = await q(`SELECT status FROM public.bank_operations WHERE request_uid = ANY($1)`, [[uid, wuid]]);
    expect(states.rows.every((r) => r.status === 'completed')).toBe(true);
  });

  it('proves reserves: wallets (minus legacy money) equal the exchange account at the bank', async () => {
    const sup = await login(app, 'super@staler.test', 'Sup3r!Admin#Pass');
    const r = await request(app).get('/api/admin/reconciliation').set(auth(sup));
    expect(r.status).toBe(200);
    const s = r.body.data;
    const inSystem = Number(s.walletsTotal) + Number(s.vouchersInEscrow) + Number(s.pendingDeposits) + Number(s.escrowHeld);
    // 390.00 (350 in wallets + 40 in a paid legacy order) came from the retired LibEuFin bank;
    // everything else must be backed 1:1 by the exchange account at TalerBank.
    expect(inSystem - 390).toBeCloseTo(Number(s.exchangeAccount.balance), 2);
  });

  it('handles a link revoked from the bank side', async () => {
    const apps = await bankApi.get('/api/linked-apps', c.token);
    for (const a of apps.body.data.apps) await bankApi.del(`/api/linked-apps/${a.id}`, c.token);
    const r = await request(app).post('/api/bank/withdraw').set(auth(u.token)).send({ amount: '1' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('BANK_LINK_REVOKED');
    expect((await request(app).get('/api/bank/link').set(auth(u.token))).body.data.linked).toBe(false);
    // and a bank-side 401 never logs the user out of S-Taler
    expect((await request(app).get('/api/wallet').set(auth(u.token))).status).toBe(200);
  });
});

// ==================================================================== messages
describe('messages', () => {
  it('are encrypted at rest and private to participants', async () => {
    const a = await walletUser(app, 'Chat Alpha');
    const b = await walletUser(app, 'Chat Beta');
    const x = await walletUser(app, 'Chat Outsider');
    const conv = await request(app).post('/api/messages/conversations').set(auth(a.token)).send({ type: 'direct', recipientId: b.userId });
    const id = conv.body.data.conversationId;
    await request(app).post(`/api/messages/conversations/${id}/messages`).set(auth(a.token)).send({ content: 'top secret <script>alert(1)</script>' });
    const raw = await q(`SELECT content FROM public.messages WHERE conversation_id = $1`, [id]);
    expect(raw.rows[0].content).toMatch(/^gcm1:/);
    const read = await request(app).get(`/api/messages/conversations/${id}/messages`).set(auth(b.token));
    expect(read.body.data.messages[0].content).toBe('top secret <script>alert(1)</script>');
    expect((await request(app).get(`/api/messages/conversations/${id}/messages`).set(auth(x.token))).status).toBe(404);
    expect((await request(app).post(`/api/messages/conversations/${id}/messages`).set(auth(x.token)).send({ content: 'hi' })).status).toBe(404);
    const unread = await request(app).get('/api/messages/unread-count').set(auth(b.token));
    expect(unread.body.data.unread).toBe(0);
  });

  it('works with the production rules: new chats, both type names, re-opening and deleting', async () => {
    const a = await walletUser(app, 'Chat Gamma');
    const b = await walletUser(app, 'Chat Delta');
    const first = await request(app).post('/api/messages/conversations').set(auth(a.token)).send({ type: 'user_to_user', recipientId: b.userId });
    expect(first.status).toBe(201);
    const again = await request(app).post('/api/messages/conversations').set(auth(b.token)).send({ type: 'direct', recipientId: a.userId });
    expect(again.body.data.conversationId).toBe(first.body.data.conversationId);
    const id = first.body.data.conversationId;
    const sent = await request(app).post(`/api/messages/conversations/${id}/messages`).set(auth(a.token)).send({ content: 'hello' });
    expect(sent.status).toBe(201);
    const list = await request(app).get('/api/messages/conversations').set(auth(b.token));
    const conv = list.body.data.conversations.find((c: any) => c.id === id);
    expect(conv.lastMessage.content).toBe('hello');
    expect(conv.unread).toBe(1);
    expect((await request(app).delete(`/api/messages/messages/${sent.body.data.message.id}`).set(auth(a.token))).status).toBe(200);
    const support = await request(app).post('/api/messages/conversations').set(auth(a.token)).send({ type: 'support' });
    expect(support.status).toBe(201);
  });
});

// ======================================================================= admin
describe('administration', () => {
  it('only the single super admin can create admins and choose their permissions', async () => {
    const oldAdmin = await login(app, 'old.admin@example.com', LEGACY_PASS);
    // regular admins cannot create admins, by any route
    expect((await request(app).post('/api/admin/users').set(auth(oldAdmin)).send({ fullName: 'X Admin', email: `${uniq()}@x.com`, password: STRONG, role: 'admin' })).status).toBe(400);
    expect((await request(app).post('/api/admin/admins').set(auth(oldAdmin)).send({ email: `${uniq()}@x.com`, fullName: 'X', password: STRONG, permissions: [] })).status).toBe(403);
    expect((await request(app).get('/api/admin/admins').set(auth(oldAdmin))).status).toBe(403);
    const sup = await login(app, 'super@staler.test', 'Sup3r!Admin#Pass');
    const mail = `${uniq()}@x.com`;
    const made = await request(app).post('/api/admin/admins').set(auth(sup)).send({ email: mail, fullName: 'Viewer Admin', password: STRONG, permissions: ['users.view'] });
    expect(made.status).toBe(201);
    // there is still exactly one super admin and it cannot be suspended or removed
    expect((await q(`SELECT count(*)::int AS n FROM public.users WHERE admin_level = 'super_admin'`)).rows[0].n).toBe(1);
    const me = await q(`SELECT id FROM public.users WHERE email = 'super@staler.test'`);
    expect((await request(app).patch(`/api/admin/users/${me.rows[0].id}`).set(auth(oldAdmin)).send({ status: 'suspended' })).status).toBe(403);
    expect((await request(app).delete(`/api/admin/admins/${me.rows[0].id}`).set(auth(sup))).status).toBe(403);
    // the new admin can only do what it was allowed to
    const viewer = await login(app, mail, STRONG);
    const target = await walletUser(app, 'Managed Person');
    expect((await request(app).get(`/api/admin/users/${target.userId}`).set(auth(viewer))).status).toBe(200);
    expect((await request(app).patch(`/api/admin/users/${target.userId}`).set(auth(viewer)).send({ status: 'suspended' })).status).toBe(403);
    expect((await request(app).get('/api/admin/settings').set(auth(viewer))).status).toBe(403);
    // super admin grants more; it applies immediately
    await request(app).patch(`/api/admin/admins/${made.body.data.id}`).set(auth(sup)).send({ permissions: ['users.view', 'users.edit', 'users.password', 'notify'] });
    const edited = await request(app).patch(`/api/admin/users/${target.userId}`).set(auth(viewer)).send({ fullName: 'Renamed Person', email: `${uniq()}@renamed.com` });
    expect(edited.status).toBe(200);
    // admins cannot manage other admins
    expect((await request(app).patch(`/api/admin/users/${made.body.data.id}`).set(auth(oldAdmin)).send({ fullName: 'Hacked Name' })).status).toBe(403);
    // set a password: the user is signed out and the new password works
    expect((await request(app).post(`/api/admin/users/${target.userId}/password`).set(auth(viewer)).send({ password: 'Brand-New#Pass2026' })).status).toBe(200);
    expect((await request(app).get('/api/wallet').set(auth(target.token))).status).toBe(401);
    // notifications
    expect((await request(app).post(`/api/admin/users/${target.userId}/notify`).set(auth(viewer)).send({ title: 'Hello', body: 'A note from support' })).status).toBe(200);
    expect((await request(app).post('/api/admin/broadcast').set(auth(viewer)).send({ title: 'News', body: 'Scheduled maintenance tonight' })).status).toBe(200);
    // demote: the account loses admin access at once
    expect((await request(app).delete(`/api/admin/admins/${made.body.data.id}`).set(auth(sup))).status).toBe(200);
    expect((await request(app).get('/api/admin/overview').set(auth(viewer))).status).toBe(401);
    const u = await walletUser(app, 'Normal Person');
    expect((await request(app).get('/api/admin/overview').set(auth(u.token))).status).toBe(403);
  });

  it('suspending a user cuts their session immediately', async () => {
    const sup = await login(app, 'super@staler.test', 'Sup3r!Admin#Pass');
    const u = await walletUser(app, 'Soon Suspended');
    await request(app).patch(`/api/admin/users/${u.userId}`).set(auth(sup)).send({ status: 'suspended' });
    expect((await request(app).get('/api/wallet').set(auth(u.token))).status).toBe(401);
    const ev = await request(app).get('/api/admin/audit?limit=20').set(auth(sup));
    expect(ev.body.data.events.map((e: any) => e.action)).toContain('admin.user_updated');
  });
});

// ============================================================ account deletion
describe('account deletion', () => {
  it('requires an empty wallet, a mailed code and the password; keeps financial records', async () => {
    const u = await walletUser(app, 'Leaving Person');
    await request(app).post('/api/auth/me/delete/request').set(auth(u.token));
    const code = lastCode(u.email);
    expect((await request(app).post('/api/auth/me/delete/confirm').set(auth(u.token)).send({ code, password: 'Wrong!Pass123' })).status).toBe(400);
    expect((await request(app).post('/api/auth/me/delete/confirm').set(auth(u.token)).send({ code, password: STRONG })).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: u.email, password: STRONG })).status).toBe(401);
    const row = await q(`SELECT email, full_name FROM public.users WHERE id = $1`, [u.userId]);
    expect(row.rows[0].full_name).toBe('Deleted user');
  });
});

import pg from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

async function recreate(url: string) {
  const u = new URL(url);
  const name = u.pathname.slice(1);
  u.pathname = '/postgres';
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await c.query(`CREATE DATABASE ${name}`);
  await c.end();
}

/**
 * - staler_test: the OLD S-Taler schema + legacy data (proves the upgrade path)
 * - talerbank_e2e: an EMPTY database (proves the bank installs from scratch)
 */
export default async function setup() {
  const staler = process.env.TEST_DATABASE_URL_STALER ?? 'postgres://postgres@127.0.0.1:5433/staler_test';
  const bankDb = process.env.TEST_DATABASE_URL_BANK_E2E ?? 'postgres://postgres@127.0.0.1:5433/talerbank_e2e';
  await recreate(staler);
  await recreate(bankDb);
  const c = new pg.Client({ connectionString: staler });
  await c.connect();
  await c.query(readFileSync(join(__dirname, 'fixtures', 'legacy-staler.sql'), 'utf8'));
  await c.end();
}

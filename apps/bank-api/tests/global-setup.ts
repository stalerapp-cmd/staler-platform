import pg from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Creates a fresh database that looks like the CURRENT production one
 * (the legacy talerbank schema from the original setup script, including its
 * default admin with the published password hash), so every test proves the
 * migrations upgrade real data safely.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL_BANK ?? 'postgres://postgres@127.0.0.1:5433/talerbank_test';
  const u = new URL(url);
  const dbName = u.pathname.slice(1);
  u.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: u.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query(readFileSync(join(__dirname, 'fixtures', 'legacy-talerbank.sql'), 'utf8'));
  await c.end();
}

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, S } from '../lib/db.js';
import { sha256 } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Applies every *.sql file in order, exactly once, inside one transaction per
 * file guarded by a transaction-level advisory lock (safe with PgBouncer /
 * Supabase pooler and with several instances booting at the same time).
 */
export async function migrate(): Promise<void> {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  try {
    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf8').replaceAll('__SCHEMA__', S);
      const checksum = sha256(sql);
      await client.query('BEGIN');
      try {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`migrate:${S}`]);
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${S}`);
        await client.query(
          `CREATE TABLE IF NOT EXISTS ${S}.schema_migrations (
             name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
        );
        const done = await client.query(`SELECT checksum FROM ${S}.schema_migrations WHERE name = $1`, [file]);
        if (done.rowCount && done.rows[0].checksum === checksum) {
          await client.query('COMMIT');
          continue;
        }
        await client.query(sql);
        await client.query(
          `INSERT INTO ${S}.schema_migrations (name, checksum) VALUES ($1, $2)
           ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now()`,
          [file, checksum],
        );
        await client.query('COMMIT');
        logger.info({ file }, 'migration applied');
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error({ err, file }, 'migration failed');
        throw err;
      }
    }
  } finally {
    client.release();
  }
}

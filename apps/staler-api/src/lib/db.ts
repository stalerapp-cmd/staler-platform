import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from './logger.js';

// NUMERIC must stay a string end-to-end — never become a JS float.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => v);
// BIGINT (e.g. COUNT(*)) -> string as well; callers convert explicitly.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => v);

function sslConfig(): pg.PoolConfig['ssl'] {
  if (env.DB_SSL === 'disable') return false;
  if (env.DB_SSL === 'verify') {
    return { rejectUnauthorized: true, ca: env.DB_CA_CERT?.replace(/\\n/g, '\n') };
  }
  // "require": encrypted, but the server certificate is not pinned.
  return { rejectUnauthorized: false };
}

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: sslConfig(),
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // Client-side timeout only: startup parameters such as statement_timeout are
  // rejected by Supabase's transaction pooler.
  query_timeout: 20_000,
});

pool.on('error', (err) => logger.error({ err }, 'idle database client error'));

export type Db = pg.Pool | pg.PoolClient;
export const S = env.DB_SCHEMA; // schema name, validated by regex in env.ts

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params: unknown[] = [],
  client: Db = pool,
): Promise<pg.QueryResult<T>> {
  return client.query<T>(text, params as any[]);
}

export async function one<T extends pg.QueryResultRow = any>(
  text: string,
  params: unknown[] = [],
  client: Db = pool,
): Promise<T | null> {
  const r = await client.query<T>(text, params as any[]);
  return r.rows[0] ?? null;
}

const RETRYABLE = new Set(['40001', '40P01']); // serialization_failure, deadlock_detected

/**
 * Runs fn inside a single transaction. Retries automatically on deadlocks
 * and serialization failures, so concurrent money movements are safe.
 */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>, retries = 4): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err: any) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* connection already broken */
      }
      if (RETRYABLE.has(err?.code) && attempt < retries) {
        await new Promise((r) => setTimeout(r, 15 * 2 ** attempt + Math.random() * 20));
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

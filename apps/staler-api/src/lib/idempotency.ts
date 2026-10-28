import { pool, S } from './db.js';
import { AppError, conflict } from './errors.js';
import { sha256 } from './crypto.js';

export interface StoredResponse {
  status: number;
  body: unknown;
}

/**
 * Exactly-once execution for money-moving requests.
 *  - same key + same request  -> the stored response is replayed, nothing runs twice
 *  - same key + other request -> 422 (key reuse is a client bug)
 *  - same key while running   -> 409 (concurrent duplicate)
 * Deterministic business errors (e.g. insufficient funds) are stored too.
 */
export async function idempotent(
  scope: string,
  key: string | undefined,
  requestBody: unknown,
  run: () => Promise<StoredResponse>,
): Promise<StoredResponse> {
  if (!key) return run();
  const reqHash = sha256(JSON.stringify(requestBody ?? null));
  const inserted = await pool.query(
    `INSERT INTO ${S}.idempotency_keys (scope, key, request_hash) VALUES ($1, $2, $3)
     ON CONFLICT (scope, key) DO NOTHING RETURNING key`,
    [scope, key, reqHash],
  );
  if (inserted.rowCount === 0) {
    const existing = await pool.query(
      `SELECT request_hash, status_code, response FROM ${S}.idempotency_keys WHERE scope = $1 AND key = $2`,
      [scope, key],
    );
    const row = existing.rows[0];
    if (!row) throw conflict('IDEMPOTENCY_RACE', 'Please retry');
    if (row.request_hash !== reqHash) {
      throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request');
    }
    if (row.status_code == null) throw conflict('REQUEST_IN_PROGRESS', 'The same request is already being processed');
    return { status: row.status_code, body: row.response };
  }
  try {
    const result = await run();
    await pool.query(`UPDATE ${S}.idempotency_keys SET status_code = $3, response = $4 WHERE scope = $1 AND key = $2`, [
      scope,
      key,
      result.status,
      JSON.stringify(result.body),
    ]);
    return result;
  } catch (err) {
    if (err instanceof AppError && err.status < 500) {
      const body = { success: false, error: { code: err.code, message: err.message } };
      await pool.query(`UPDATE ${S}.idempotency_keys SET status_code = $3, response = $4 WHERE scope = $1 AND key = $2`, [
        scope,
        key,
        err.status,
        JSON.stringify(body),
      ]);
    } else {
      await pool.query(`DELETE FROM ${S}.idempotency_keys WHERE scope = $1 AND key = $2`, [scope, key]);
    }
    throw err;
  }
}

import { pool, S, tx } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { refundVoucher } from './exchange.js';
import { releaseEscrow } from './commerce.js';

/** Periodic clean-up: expired artefacts, expired vouchers (refunded), stale escrow auto-release. */
export async function housekeeping() {
  await pool.query(`DELETE FROM ${S}.idempotency_keys WHERE created_at < now() - interval '2 days'`);
  await pool.query(`DELETE FROM ${S}.refresh_tokens WHERE family_expires_at < now() - interval '7 days'`);
  await pool.query(`DELETE FROM ${S}.pending_users WHERE expires_at < now()`);
  await pool.query(`DELETE FROM ${S}.webhook_events WHERE received_at < now() - interval '7 days'`);

  const vouchers = await pool.query(`SELECT id FROM ${S}.exchange_vouchers WHERE status = 'active' AND expires_at < now() LIMIT 100`);
  for (const v of vouchers.rows) await refundVoucher(v.id, 'cancelled');

  // Shipped orders the buyer never confirmed are paid out after 14 days.
  const stale = await pool.query(
    `SELECT id FROM ${S}.orders WHERE status = 'shipped' AND escrow_status = 'held' AND dispute_status IS DISTINCT FROM 'open' AND COALESCE(balance_due, 0) = 0 AND shipped_at < now() - interval '14 days' LIMIT 100`,
  );
  for (const o of stale.rows) await tx((c) => releaseEscrow(c, o.id, 'auto-released after 14 days'));
  if (vouchers.rowCount || stale.rowCount) logger.info({ vouchers: vouchers.rowCount, orders: stale.rowCount }, 'housekeeping done');
}

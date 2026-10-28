import { env } from '../config/env.js';
import { one, S, tx } from '../lib/db.js';
import { hashPassword, isPublishedDefaultHash } from '../lib/passwords.js';
import { generateAccountNumber, generateIban } from '../lib/iban.js';
import { logger } from '../lib/logger.js';

export const paytoFor = (iban: string, name: string) =>
  `payto://iban/${env.BANK_BIC}/${iban}?receiver-name=${encodeURIComponent(name).replace(/%20/g, '+')}`;

/**
 * Makes sure the two system accounts exist:
 *  - the bank's admin (central) account, which may go negative up to
 *    ADMIN_DEBIT_THRESHOLD — it is where cash-ins and sign-up bonuses come from;
 *  - the exchange account that backs every S-Taler wallet balance.
 * Also neutralises the default admin password that was published in old docs.
 */
export async function bootstrap(): Promise<void> {
  await tx(async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`bootstrap:${S}`]);

    // ---- admin
    let admin = await one<{ id: string; password_hash: string; email: string }>(
      `SELECT id, password_hash, email FROM ${S}.users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`,
      [],
      c,
    );
    if (!admin && env.BANK_ADMIN_EMAIL && env.BANK_ADMIN_PASSWORD) {
      admin = await one(
        `INSERT INTO ${S}.users (full_name, email, username, password_hash, role, status, email_verified, password_changed_at)
         VALUES ('Bank Administrator', $1, 'admin', $2, 'admin', 'active', true, now())
         ON CONFLICT DO NOTHING RETURNING id, password_hash, email`,
        [env.BANK_ADMIN_EMAIL.toLowerCase(), await hashPassword(env.BANK_ADMIN_PASSWORD)],
        c,
      );
      logger.info('bank administrator created from BANK_ADMIN_EMAIL');
    } else if (admin && isPublishedDefaultHash(admin.password_hash)) {
      if (env.BANK_ADMIN_PASSWORD) {
        await c.query(
          `UPDATE ${S}.users SET password_hash = $2, password_changed_at = now(), token_version = token_version + 1,
                  email = COALESCE($3, email) WHERE id = $1`,
          [admin.id, await hashPassword(env.BANK_ADMIN_PASSWORD), env.BANK_ADMIN_EMAIL?.toLowerCase() ?? null],
        );
        logger.warn('admin password was a published default — rotated to BANK_ADMIN_PASSWORD');
      } else {
        logger.warn('admin still has the published default password: login is DISABLED until BANK_ADMIN_PASSWORD is set');
      }
    }
    if (admin) {
      const acc = await one(`SELECT id FROM ${S}.bank_accounts WHERE user_id = $1 LIMIT 1`, [admin.id], c);
      if (!acc) {
        const iban = generateIban();
        await c.query(
          `INSERT INTO ${S}.bank_accounts (user_id, account_number, iban, currency, balance, debit_threshold, payto_uri, nickname)
           VALUES ($1, $2, $3, $4, 0, $5, $6, 'Central account')`,
          [admin.id, generateAccountNumber(), iban, env.CURRENCY, env.ADMIN_DEBIT_THRESHOLD, paytoFor(iban, env.BANK_NAME)],
        );
      } else {
        await c.query(
          `UPDATE ${S}.bank_accounts SET debit_threshold = GREATEST(COALESCE(debit_threshold,0), $2::numeric) WHERE id = $1`,
          [acc.id, env.ADMIN_DEBIT_THRESHOLD],
        );
      }
    }

    // ---- legacy accounts that never received an IBAN get a valid one now
    const noIban = await c.query<{ id: string; full_name: string }>(
      `SELECT a.id, u.full_name FROM ${S}.bank_accounts a JOIN ${S}.users u ON u.id = a.user_id WHERE a.iban IS NULL`,
    );
    for (const a of noIban.rows) {
      const iban = generateIban();
      await c.query(`UPDATE ${S}.bank_accounts SET iban = $2, payto_uri = COALESCE(payto_uri, $3) WHERE id = $1`, [a.id, iban, paytoFor(iban, a.full_name)]);
    }

    // ---- exchange (no interactive login; authenticated by EXCHANGE_API_TOKEN only)
    let exUser = await one<{ id: string }>(
      `SELECT id FROM ${S}.users WHERE role = 'exchange' ORDER BY created_at ASC LIMIT 1`,
      [],
      c,
    );
    if (!exUser) {
      exUser = await one(
        `INSERT INTO ${S}.users (full_name, email, username, password_hash, role, status, email_verified)
         VALUES ('S-Taler Exchange', 'exchange@talerbank.local', 'exchange', '$2b$12$placeholder', 'exchange', 'active', true)
         ON CONFLICT DO NOTHING RETURNING id`,
        [],
        c,
      );
    }
    // Exchange accounts never accept a password: neutralise whatever is stored.
    if (exUser) {
      await c.query(`UPDATE ${S}.users SET password_hash = '$2b$12$placeholder' WHERE id = $1 AND password_hash <> '$2b$12$placeholder'`, [exUser.id]);
      const exAcc = await one(
        `SELECT id FROM ${S}.bank_accounts WHERE is_taler_exchange = true ORDER BY created_at ASC LIMIT 1`,
        [],
        c,
      );
      if (!exAcc) {
        const iban = generateIban();
        await c.query(
          `INSERT INTO ${S}.bank_accounts (user_id, account_number, iban, currency, balance, is_taler_exchange, payto_uri, nickname)
           VALUES ($1, 'EXCHANGE001', $2, $3, 0, true, $4, 'Exchange reserve account')
           ON CONFLICT (account_number) DO NOTHING`,
          [exUser.id, iban, env.CURRENCY, paytoFor(iban, 'S-Taler Exchange')],
        );
      }
    }
  });
}

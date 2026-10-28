import { env } from '../config/env.js';
import { one, S, tx } from '../lib/db.js';
import { encrypt, legacyDecrypt } from '../lib/crypto.js';
import { hashPassword, isPublishedDefaultHash } from '../lib/passwords.js';
import { logger } from '../lib/logger.js';
import { createWallet } from '../modules/walletCore.js';

/**
 * One-time data hardening + first super-admin:
 *  - users without a wallet get one (old admin accounts sometimes had none)
 *  - plaintext / AES-CBC reserve private keys are re-encrypted with AES-GCM
 *  - ADMIN_EMAIL/ADMIN_PASSWORD create the first super admin on an empty system
 */
export async function bootstrap(): Promise<void> {
  await tx(async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`bootstrap:${S}`]);

    const noWallet = await c.query(`SELECT u.id FROM ${S}.users u WHERE NOT EXISTS (SELECT 1 FROM ${S}.wallets w WHERE w.user_id = u.id)`);
    for (const u of noWallet.rows) await createWallet(c, u.id);

    const keys = await c.query(`SELECT id, reserve_priv FROM ${S}.reserves WHERE reserve_priv IS NOT NULL AND reserve_priv NOT LIKE 'gcm1:%'`);
    for (const k of keys.rows) {
      const plain = legacyDecrypt(k.reserve_priv, env.LEGACY_ENCRYPTION_KEY) ?? k.reserve_priv;
      await c.query(`UPDATE ${S}.reserves SET reserve_priv = $2 WHERE id = $1`, [k.id, encrypt(plain, 'reserve')]);
    }
    if (keys.rowCount) logger.info({ count: keys.rowCount }, 're-encrypted legacy reserve keys');

    const superAdmin = await one(`SELECT id FROM ${S}.users WHERE role = 'admin' AND admin_level = 'super_admin' AND status = 'active' LIMIT 1`, [], c);
    if (!superAdmin && env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
      const existing = await one<any>(`SELECT id, password_hash FROM ${S}.users WHERE lower(email) = $1`, [env.ADMIN_EMAIL.toLowerCase()], c);
      if (existing) {
        await c.query(
          `UPDATE ${S}.users SET role = 'admin', admin_level = 'super_admin', status = 'active',
                  password_hash = CASE WHEN $2 THEN $3 ELSE password_hash END, token_version = token_version + 1 WHERE id = $1`,
          [existing.id, isPublishedDefaultHash(existing.password_hash), await hashPassword(env.ADMIN_PASSWORD)],
        );
      } else {
        const u = await one<any>(
          `INSERT INTO ${S}.users (email, password_hash, full_name, role, admin_level, email_verified, email_verified_at, verification_method, password_changed_at)
           VALUES ($1, $2, 'S-Taler Administrator', 'admin', 'super_admin', true, now(), 'email', now()) RETURNING id`,
          [env.ADMIN_EMAIL.toLowerCase(), await hashPassword(env.ADMIN_PASSWORD)],
          c,
        );
        await createWallet(c, u.id);
      }
      logger.info('super admin ensured from ADMIN_EMAIL');
    }
  });
}

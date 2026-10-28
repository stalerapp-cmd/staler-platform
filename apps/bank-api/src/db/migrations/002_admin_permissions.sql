-- Granular administrator permissions for TalerBank (same model as S-Taler).
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS admin_level TEXT;
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS admin_permissions TEXT[] NOT NULL DEFAULT '{}';
DO $$ BEGIN
  ALTER TABLE __SCHEMA__.users ADD CONSTRAINT users_admin_level_check CHECK (admin_level IS NULL OR admin_level IN ('super_admin', 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The oldest active administrator becomes the single super admin (bootstrap
-- re-asserts this for BANK_ADMIN_EMAIL); any other admins keep full access.
UPDATE __SCHEMA__.users SET admin_level = 'super_admin'
 WHERE id = (SELECT id FROM __SCHEMA__.users WHERE role = 'admin' AND status = 'active' ORDER BY created_at NULLS LAST LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM __SCHEMA__.users WHERE admin_level = 'super_admin');
UPDATE __SCHEMA__.users
   SET admin_level = 'admin',
       admin_permissions = ARRAY['customers.view','customers.edit','customers.password','customers.status','customers.delete','customers.security',
                                 'accounts.freeze','teller','ledger.view','exchange.view','audit.view','settings.manage','notify']
 WHERE role = 'admin' AND admin_level IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_single_super_admin ON __SCHEMA__.users ((admin_level)) WHERE admin_level = 'super_admin';

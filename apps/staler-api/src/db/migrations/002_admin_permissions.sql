-- Granular administrator permissions. The single super admin can do everything
-- and is the only one who can create admins and decide what each may do.
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS admin_permissions TEXT[] NOT NULL DEFAULT '{}';

-- Existing (non-super) admins keep the access they had before this change.
UPDATE __SCHEMA__.users
   SET admin_permissions = ARRAY['users.view','users.edit','users.password','users.status','users.delete','users.security','users.role',
                                 'wallets.freeze','stores.manage','pending.manage','notify','support','bank.ops','audit.view','settings.manage']
 WHERE role = 'admin' AND COALESCE(admin_level, 'admin') <> 'super_admin' AND admin_permissions = '{}';

-- Only one super admin may exist.
CREATE UNIQUE INDEX IF NOT EXISTS users_single_super_admin ON __SCHEMA__.users ((admin_level)) WHERE admin_level = 'super_admin';

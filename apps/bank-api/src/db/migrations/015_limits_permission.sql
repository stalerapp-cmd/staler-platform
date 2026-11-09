-- 015: transfer limits get their own permission; admins who could change settings keep it.
UPDATE __SCHEMA__.users SET admin_permissions = (SELECT array_agg(DISTINCT p) FROM unnest(admin_permissions || ARRAY['limits.manage']) p)
WHERE role = 'admin' AND 'settings.manage' = ANY(admin_permissions) AND NOT ('limits.manage' = ANY(admin_permissions));

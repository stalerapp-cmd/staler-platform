-- Where each device signed in from: one row per (device, network address) with how
-- often, plus the approximate place that address belongs to. Kept for security review.
CREATE TABLE IF NOT EXISTS __SCHEMA__.user_device_places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES __SCHEMA__.user_devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  ip TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 1,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (device_id, ip)
);
CREATE INDEX IF NOT EXISTS user_device_places_user_idx ON __SCHEMA__.user_device_places (user_id, last_seen DESC);

-- Every sign-in, for the per-device timeline.
CREATE TABLE IF NOT EXISTS __SCHEMA__.user_signins (
  id BIGSERIAL PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES __SCHEMA__.user_devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  ip TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_signins_device_idx ON __SCHEMA__.user_signins (device_id, at DESC);

-- Address → place, looked up once and reused.
CREATE TABLE IF NOT EXISTS __SCHEMA__.ip_geo (
  ip TEXT PRIMARY KEY,
  ok BOOLEAN NOT NULL,
  city TEXT, region TEXT, country TEXT, country_code TEXT,
  lat DOUBLE PRECISION, lng DOUBLE PRECISION,
  isp TEXT, org TEXT, timezone TEXT,
  looked_up_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE __SCHEMA__.user_device_places ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.user_signins ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.ip_geo ENABLE ROW LEVEL SECURITY;

-- Finer permissions were split out of broader ones: admins keep exactly what they could do.
UPDATE __SCHEMA__.users SET admin_permissions = (
  SELECT array_agg(DISTINCT p) FROM unnest(
    admin_permissions
    || CASE WHEN 'users.view' = ANY(admin_permissions) THEN ARRAY['users.money', 'users.devices'] ELSE '{}'::text[] END
    || CASE WHEN 'users.edit' = ANY(admin_permissions) THEN ARRAY['agents.manage'] ELSE '{}'::text[] END
    || CASE WHEN 'stores.manage' = ANY(admin_permissions) THEN ARRAY['stores.delete'] ELSE '{}'::text[] END
    || CASE WHEN 'users.delete' = ANY(admin_permissions) THEN ARRAY['users.force_delete'] ELSE '{}'::text[] END
  ) p)
WHERE role = 'admin' AND cardinality(admin_permissions) > 0;

-- Every device a person has signed in from, once per device (browser/app on a machine),
-- kept after its sessions expire so support can see the full history.
CREATE TABLE IF NOT EXISTS __SCHEMA__.user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  device_key TEXT NOT NULL,
  user_agent TEXT,
  first_ip TEXT,
  last_ip TEXT,
  ips TEXT[] NOT NULL DEFAULT '{}',
  sign_ins INTEGER NOT NULL DEFAULT 0,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_key)
);
CREATE INDEX IF NOT EXISTS user_devices_user_idx ON __SCHEMA__.user_devices (user_id, last_seen DESC);
ALTER TABLE __SCHEMA__.user_devices ENABLE ROW LEVEL SECURITY;
-- Start the history from the sessions we still have.
INSERT INTO __SCHEMA__.user_devices (user_id, device_key, user_agent, first_ip, last_ip, ips, sign_ins, first_seen, last_seen)
SELECT user_id, md5(COALESCE(user_agent, '')), max(user_agent), (array_agg(ip_address ORDER BY created_at))[1], (array_agg(ip_address ORDER BY created_at DESC))[1],
       (SELECT array_agg(DISTINCT x) FROM unnest(array_agg(ip_address)) x WHERE x IS NOT NULL), count(DISTINCT family_id), min(created_at), max(COALESCE(last_used_at, created_at))
  FROM __SCHEMA__.refresh_tokens GROUP BY user_id, md5(COALESCE(user_agent, ''))
ON CONFLICT (user_id, device_key) DO NOTHING;

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


-- Seeing a customer's devices and places is its own permission; admins who could view customers keep it.
UPDATE __SCHEMA__.users SET admin_permissions = (SELECT array_agg(DISTINCT p) FROM unnest(admin_permissions || ARRAY['customers.devices']) p)
WHERE role = 'admin' AND 'customers.view' = ANY(admin_permissions);

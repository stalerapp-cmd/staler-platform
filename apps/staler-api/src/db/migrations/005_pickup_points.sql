-- Pickup points: places a store hands orders over (a shop counter, a partner kiosk…).
CREATE TABLE IF NOT EXISTS __SCHEMA__.pickup_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES __SCHEMA__.merchants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  city TEXT,
  address TEXT,
  hours TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  active BOOLEAN NOT NULL DEFAULT true,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pickup_points_merchant_idx ON __SCHEMA__.pickup_points (merchant_id);
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS pickup_point_id UUID REFERENCES __SCHEMA__.pickup_points(id) ON DELETE SET NULL;
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS pickup_info JSONB;

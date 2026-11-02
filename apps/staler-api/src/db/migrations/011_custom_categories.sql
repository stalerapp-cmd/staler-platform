-- Store categories that store owners suggest. A suggestion waits for an admin;
-- once approved it is offered to everyone next to the built-in categories.
CREATE TABLE IF NOT EXISTS __SCHEMA__.store_categories (
  slug TEXT PRIMARY KEY,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
  merchant_id UUID REFERENCES __SCHEMA__.merchants(id) ON DELETE SET NULL,
  reason TEXT,
  reviewed_by UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_categories_status_idx ON __SCHEMA__.store_categories (status, created_at DESC);
CREATE INDEX IF NOT EXISTS store_categories_merchant_idx ON __SCHEMA__.store_categories (merchant_id);
ALTER TABLE __SCHEMA__.store_categories ENABLE ROW LEVEL SECURITY;

-- Stores and their customers: following / muting a store, store announcements,
-- loyalty (after N orders → a discount), occasion offers, and gifts with orders.
-- Everything belongs to the MAIN store (branches share their main store's settings).

-- A person who wants (or doesn't want) a store's announcements. Buyers get them
-- by default; a row with notify = false mutes that store for them.
CREATE TABLE IF NOT EXISTS __SCHEMA__.store_followers (
  merchant_id UUID NOT NULL REFERENCES __SCHEMA__.merchants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  notify BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant_id, user_id)
);
CREATE INDEX IF NOT EXISTS store_followers_user_idx ON __SCHEMA__.store_followers (user_id);

CREATE TABLE IF NOT EXISTS __SCHEMA__.store_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES __SCHEMA__.merchants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tone TEXT NOT NULL DEFAULT 'news',
  audience TEXT NOT NULL DEFAULT 'all',
  sent_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_announcements_merchant_idx ON __SCHEMA__.store_announcements (merchant_id, created_at DESC);

-- Loyalty: after `loyal_after` orders a customer is "loyal"; loyal customers may get a discount.
CREATE TABLE IF NOT EXISTS __SCHEMA__.store_perks (
  merchant_id UUID PRIMARY KEY REFERENCES __SCHEMA__.merchants(id) ON DELETE CASCADE,
  loyal_after INT CHECK (loyal_after IS NULL OR loyal_after BETWEEN 2 AND 1000),
  loyal_discount NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (loyal_discount >= 0 AND loyal_discount <= 90),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Offers for occasions: a percentage off everything, for everyone or loyal customers, between two dates.
CREATE TABLE IF NOT EXISTS __SCHEMA__.store_promos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES __SCHEMA__.merchants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  percent NUMERIC(5,2) NOT NULL CHECK (percent > 0 AND percent <= 90),
  audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'loyal')),
  min_total NUMERIC(20,2) NOT NULL DEFAULT 0,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_promos_merchant_idx ON __SCHEMA__.store_promos (merchant_id, ends_at DESC);

-- Gifts packed with orders, by rule.
CREATE TABLE IF NOT EXISTS __SCHEMA__.store_gift_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES __SCHEMA__.merchants(id) ON DELETE CASCADE,
  gift TEXT NOT NULL,
  rule TEXT NOT NULL CHECK (rule IN ('every', 'first', 'loyal', 'min_total')),
  threshold NUMERIC(20,2),
  ends_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_gift_rules_merchant_idx ON __SCHEMA__.store_gift_rules (merchant_id);

ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(20,2) NOT NULL DEFAULT 0;
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS discount_note TEXT;
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS gifts JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS orders_user_merchant_idx ON __SCHEMA__.orders (user_id, merchant_id);

ALTER TABLE __SCHEMA__.store_followers ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.store_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.store_perks ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.store_promos ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.store_gift_rules ENABLE ROW LEVEL SECURITY;

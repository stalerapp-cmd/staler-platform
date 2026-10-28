-- Commerce v2: stores & branches, store pages, ads, deposits (عربون),
-- proof-of-delivery, tracking, disputes, protected digital downloads,
-- contacts, richer messages.

-- ------------------------------------------------------------ stores
-- A merchant account can own several stores; a store can have branches
-- (rows whose parent_id points at the main store).
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES __SCHEMA__.merchants(id) ON DELETE CASCADE;
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS branch_name TEXT;
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS cover_url TEXT;
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS show_phone BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS accent TEXT;
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS delivery_note TEXT;
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS offers_pickup BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS offers_delivery BOOLEAN NOT NULL DEFAULT true;
UPDATE __SCHEMA__.merchants
   SET slug = coalesce(nullif(lower(trim(both '-' from regexp_replace(coalesce(store_name, ''), '[^A-Za-z0-9]+', '-', 'g'))), ''), 'store')
              || '-' || substr(md5(id::text), 1, 6)
 WHERE slug IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS merchants_slug_uq ON __SCHEMA__.merchants (slug);
CREATE INDEX IF NOT EXISTS merchants_user_idx ON __SCHEMA__.merchants (user_id);
CREATE INDEX IF NOT EXISTS merchants_parent_idx ON __SCHEMA__.merchants (parent_id);

-- Promotional ads shown on the store page (image or short video).
CREATE TABLE IF NOT EXISTS __SCHEMA__.store_ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES __SCHEMA__.merchants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  media_url TEXT NOT NULL,
  title TEXT,
  body TEXT,
  product_id UUID REFERENCES __SCHEMA__.products(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  sort INT NOT NULL DEFAULT 0,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_ads_merchant_idx ON __SCHEMA__.store_ads (merchant_id, sort);

-- ---------------------------------------------------------- products
-- deposit_percent > 0: the buyer pays that share now (held in escrow) and the rest
-- on delivery / at pickup. Digital products: download (personalised copy) or view-only.
ALTER TABLE __SCHEMA__.products ADD COLUMN IF NOT EXISTS deposit_percent INT NOT NULL DEFAULT 0;
ALTER TABLE __SCHEMA__.products ADD COLUMN IF NOT EXISTS deposit_refundable BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE __SCHEMA__.products ADD COLUMN IF NOT EXISTS compare_at_price NUMERIC(20,2);
ALTER TABLE __SCHEMA__.products ADD COLUMN IF NOT EXISTS digital_mode TEXT NOT NULL DEFAULT 'download';
ALTER TABLE __SCHEMA__.products ADD COLUMN IF NOT EXISTS download_limit INT NOT NULL DEFAULT 3;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_deposit_range' AND conrelid = '__SCHEMA__.products'::regclass) THEN
    ALTER TABLE __SCHEMA__.products ADD CONSTRAINT products_deposit_range CHECK (deposit_percent BETWEEN 0 AND 90);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_digital_mode' AND conrelid = '__SCHEMA__.products'::regclass) THEN
    ALTER TABLE __SCHEMA__.products ADD CONSTRAINT products_digital_mode CHECK (digital_mode IN ('download', 'view'));
  END IF;
END $$;

-- ------------------------------------------------------------ orders
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(20,2);
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS balance_due NUMERIC(20,2) NOT NULL DEFAULT 0;
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS balance_paid_at TIMESTAMPTZ;
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS balance_paid_via TEXT;
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS deposit_refundable BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS fulfillment TEXT NOT NULL DEFAULT 'delivery';
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS delivery_phone TEXT;
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS delivery_lat DOUBLE PRECISION;
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS delivery_lng DOUBLE PRECISION;
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS handover_code TEXT;
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS handover_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS dispute_status TEXT;
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS dispute_reason TEXT;
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS buyer_note TEXT;
UPDATE __SCHEMA__.orders SET amount_paid = total_amount WHERE amount_paid IS NULL AND payment_status = 'completed';

-- Timeline of everything that happened to an order (also the tracking map points).
CREATE TABLE IF NOT EXISTS __SCHEMA__.order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES __SCHEMA__.orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  actor TEXT NOT NULL,
  note TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_events_order_idx ON __SCHEMA__.order_events (order_id, created_at);

-- ------------------------------------------------- protected downloads
ALTER TABLE __SCHEMA__.order_items ADD COLUMN IF NOT EXISTS downloads INT NOT NULL DEFAULT 0;
ALTER TABLE __SCHEMA__.order_items ADD COLUMN IF NOT EXISTS licence_code TEXT;
CREATE TABLE IF NOT EXISTS __SCHEMA__.download_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id UUID NOT NULL REFERENCES __SCHEMA__.order_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL DEFAULT 'download',
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS download_tickets_item_idx ON __SCHEMA__.download_tickets (order_item_id);

-- ---------------------------------------------------------- contacts
CREATE TABLE IF NOT EXISTS __SCHEMA__.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  contact_user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  nickname TEXT,
  favourite BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, contact_user_id)
);

-- ---------------------------------------------------------- messages
ALTER TABLE __SCHEMA__.messages ADD COLUMN IF NOT EXISTS reply_to UUID;
ALTER TABLE __SCHEMA__.messages ADD COLUMN IF NOT EXISTS reactions JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE __SCHEMA__.messages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'text';
ALTER TABLE __SCHEMA__.messages ADD COLUMN IF NOT EXISTS meta JSONB;
ALTER TABLE __SCHEMA__.conversations ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP;

-- "Exchange" is no longer a separate account type: cash vouchers are open to every
-- personal and business account, so former exchange accounts become personal ones.
UPDATE __SCHEMA__.users SET role = 'user' WHERE role = 'exchange';

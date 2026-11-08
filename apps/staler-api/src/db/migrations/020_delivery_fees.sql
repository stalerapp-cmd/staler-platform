-- 020: delivery prices set by each store (free, one price, or a price per area),
-- charged with the order and shown to the customer before paying.
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS delivery_mode TEXT NOT NULL DEFAULT 'free';
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(20,2) NOT NULL DEFAULT 0;
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS delivery_zones JSONB NOT NULL DEFAULT '[]'::jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merchants_delivery_mode' AND conrelid = '__SCHEMA__.merchants'::regclass) THEN
    ALTER TABLE __SCHEMA__.merchants ADD CONSTRAINT merchants_delivery_mode CHECK (delivery_mode IN ('free', 'flat', 'zones'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merchants_delivery_fee' AND conrelid = '__SCHEMA__.merchants'::regclass) THEN
    ALTER TABLE __SCHEMA__.merchants ADD CONSTRAINT merchants_delivery_fee CHECK (delivery_fee >= 0);
  END IF;
END $$;

ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(20,2) NOT NULL DEFAULT 0;
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS delivery_zone TEXT;

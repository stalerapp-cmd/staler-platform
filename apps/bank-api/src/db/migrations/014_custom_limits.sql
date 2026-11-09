-- 014: a daily transfer limit set for one customer (higher or lower than their type's).
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS daily_limit NUMERIC(20,2);
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS daily_limit_note TEXT;
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS daily_limit_by UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL;
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS daily_limit_at TIMESTAMPTZ;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_daily_limit_positive' AND conrelid = '__SCHEMA__.users'::regclass) THEN
    ALTER TABLE __SCHEMA__.users ADD CONSTRAINT users_daily_limit_positive CHECK (daily_limit IS NULL OR daily_limit >= 0);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS users_daily_limit_idx ON __SCHEMA__.users (daily_limit) WHERE daily_limit IS NOT NULL;

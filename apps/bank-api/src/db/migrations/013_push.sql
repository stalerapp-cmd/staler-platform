-- 013: device notifications.
-- Push notifications to devices whose owner turned them on (Web Push, VAPID).
-- One row per browser or app install. Language and alerts are per device.
CREATE TABLE IF NOT EXISTS __SCHEMA__.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'ar',
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_ok_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON __SCHEMA__.push_subscriptions (user_id);
ALTER TABLE __SCHEMA__.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Which notifications were already pushed. Older ones count as sent, so nothing old goes out.
ALTER TABLE __SCHEMA__.notifications ADD COLUMN IF NOT EXISTS pushed_at TIMESTAMPTZ;
UPDATE __SCHEMA__.notifications SET pushed_at = created_at WHERE pushed_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_unpushed_idx ON __SCHEMA__.notifications (created_at) WHERE pushed_at IS NULL;

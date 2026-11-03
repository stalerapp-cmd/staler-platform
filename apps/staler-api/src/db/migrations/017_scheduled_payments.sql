-- 017: scheduled payments, the simple way. A payment goes to a person (a group is
-- optional, just to sort them): once or every week / two weeks / month / N days,
-- forever, until a date or for a number of payments (instalments of a debt), sent
-- automatically or only reminded, with a reminder N days before.

ALTER TABLE __SCHEMA__.people_members ALTER COLUMN group_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS people_members_owner_user_uq ON __SCHEMA__.people_members (owner_id, user_id);
-- A group can carry the "work" features (workplace on profiles, seniority, bonuses).
ALTER TABLE __SCHEMA__.people_groups ADD COLUMN IF NOT EXISTS is_work BOOLEAN NOT NULL DEFAULT false;
UPDATE __SCHEMA__.people_groups SET is_work = true WHERE kind = 'staff';
ALTER TABLE __SCHEMA__.people_groups DROP CONSTRAINT IF EXISTS people_groups_kind_check;

ALTER TABLE __SCHEMA__.payouts DROP CONSTRAINT IF EXISTS payouts_every_check;
ALTER TABLE __SCHEMA__.payouts ADD CONSTRAINT payouts_every_check CHECK (every IN ('once', 'week', '2weeks', 'month', 'days'));
ALTER TABLE __SCHEMA__.payouts ADD COLUMN IF NOT EXISTS every_days INT CHECK (every_days IS NULL OR every_days BETWEEN 1 AND 365);
ALTER TABLE __SCHEMA__.payouts ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE __SCHEMA__.payouts ADD COLUMN IF NOT EXISTS ends TEXT NOT NULL DEFAULT 'never' CHECK (ends IN ('never', 'until', 'count'));
ALTER TABLE __SCHEMA__.payouts ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE __SCHEMA__.payouts ADD COLUMN IF NOT EXISTS max_runs INT CHECK (max_runs IS NULL OR max_runs BETWEEN 1 AND 1000);
-- false = don't send by itself: remind the owner, who pays with one tap.
ALTER TABLE __SCHEMA__.payouts ADD COLUMN IF NOT EXISTS auto BOOLEAN NOT NULL DEFAULT true;
-- Days before to remind (0 = the same day, NULL = no reminder).
ALTER TABLE __SCHEMA__.payouts ADD COLUMN IF NOT EXISTS remind_before INT CHECK (remind_before IS NULL OR remind_before BETWEEN 0 AND 30);
ALTER TABLE __SCHEMA__.payouts ADD COLUMN IF NOT EXISTS reminded_for TIMESTAMPTZ;
ALTER TABLE __SCHEMA__.payouts ADD COLUMN IF NOT EXISTS awaiting BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE __SCHEMA__.payouts ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
ALTER TABLE __SCHEMA__.payout_runs DROP CONSTRAINT IF EXISTS payout_runs_kind_check;
ALTER TABLE __SCHEMA__.payout_runs ADD CONSTRAINT payout_runs_kind_check CHECK (kind IN ('scheduled', 'bonus', 'manual', 'skipped'));
ALTER TABLE __SCHEMA__.payout_runs DROP CONSTRAINT IF EXISTS payout_runs_status_check;
ALTER TABLE __SCHEMA__.payout_runs ADD CONSTRAINT payout_runs_status_check CHECK (status IN ('done', 'failed', 'waiting', 'skipped'));

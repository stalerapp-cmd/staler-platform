-- 016: your people in groups (children, staff, relatives or a name you choose), with
-- recurring transfers to them; support calls with booked times.

CREATE TABLE IF NOT EXISTS __SCHEMA__.people_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('family', 'staff', 'relatives', 'custom')),
  icon TEXT,
  -- Shown on members' profiles if they accept ("works at …").
  workplace TEXT,
  -- After how many months someone counts as a long-standing member ("old").
  senior_after_months INT,
  sort INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS people_groups_owner_idx ON __SCHEMA__.people_groups (owner_id, sort);

CREATE TABLE IF NOT EXISTS __SCHEMA__.people_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES __SCHEMA__.people_groups(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  nickname TEXT,
  role_title TEXT,
  since DATE,
  favourite BOOLEAN NOT NULL DEFAULT false,
  sort INT NOT NULL DEFAULT 0,
  -- The member's answer to appearing as working here.
  link_status TEXT NOT NULL DEFAULT 'none' CHECK (link_status IN ('none', 'invited', 'accepted', 'declined')),
  show_on_profile BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS people_members_user_idx ON __SCHEMA__.people_members (user_id);

CREATE TABLE IF NOT EXISTS __SCHEMA__.payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES __SCHEMA__.people_members(id) ON DELETE CASCADE,
  amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  source TEXT NOT NULL DEFAULT 'wallet' CHECK (source IN ('wallet', 'bank')),
  dest TEXT NOT NULL DEFAULT 'wallet' CHECK (dest IN ('wallet', 'bank')),
  every TEXT NOT NULL CHECK (every IN ('week', '2weeks', 'month')),
  next_run_at TIMESTAMPTZ NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  paused_by_admin BOOLEAN NOT NULL DEFAULT false,
  admin_note TEXT,
  note TEXT,
  pending_op UUID,
  fail_count INT NOT NULL DEFAULT 0,
  runs INT NOT NULL DEFAULT 0,
  total NUMERIC(20,2) NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payouts_due_idx ON __SCHEMA__.payouts (next_run_at) WHERE active AND NOT paused_by_admin;

CREATE TABLE IF NOT EXISTS __SCHEMA__.payout_runs (
  id BIGSERIAL PRIMARY KEY,
  payout_id UUID REFERENCES __SCHEMA__.payouts(id) ON DELETE SET NULL,
  owner_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  member_user_id UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
  member_id UUID REFERENCES __SCHEMA__.people_members(id) ON DELETE SET NULL,
  amount NUMERIC(20,2) NOT NULL,
  kind TEXT NOT NULL DEFAULT 'scheduled' CHECK (kind IN ('scheduled', 'bonus')),
  status TEXT NOT NULL CHECK (status IN ('done', 'failed', 'waiting')),
  error TEXT,
  note TEXT,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payout_runs_owner_idx ON __SCHEMA__.payout_runs (owner_id, ran_at DESC);

-- ------------------------------------------------------------------- calls
ALTER TABLE __SCHEMA__.system_settings ADD COLUMN IF NOT EXISTS call_hours JSONB NOT NULL
  DEFAULT '{"days":[0,1,2,3,4,6],"from":"09:00","to":"17:00","slot":30}'::jsonb;

CREATE TABLE IF NOT EXISTS __SCHEMA__.call_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  admin_id UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
  initiated_by TEXT NOT NULL DEFAULT 'user' CHECK (initiated_by IN ('user', 'admin')),
  topic TEXT,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'accepted', 'scheduled', 'declined', 'cancelled', 'done', 'missed')),
  slot_at TIMESTAMPTZ,
  button_visible BOOLEAN NOT NULL DEFAULT false,
  cancel_requested BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS call_requests_status_idx ON __SCHEMA__.call_requests (status, slot_at);
CREATE INDEX IF NOT EXISTS call_requests_user_idx ON __SCHEMA__.call_requests (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS __SCHEMA__.call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID REFERENCES __SCHEMA__.call_requests(id) ON DELETE SET NULL,
  caller_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  callee_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing', 'active', 'ended', 'missed', 'declined')),
  video BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS call_sessions_callee_idx ON __SCHEMA__.call_sessions (callee_id, status);

CREATE TABLE IF NOT EXISTS __SCHEMA__.call_relay (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES __SCHEMA__.call_sessions(id) ON DELETE CASCADE,
  to_user UUID NOT NULL,
  kind TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS call_relay_idx ON __SCHEMA__.call_relay (session_id, to_user, id);

ALTER TABLE __SCHEMA__.people_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.people_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.payout_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.call_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.call_relay ENABLE ROW LEVEL SECURITY;

-- Admins who can see people's money also oversee groups and recurring transfers.
UPDATE __SCHEMA__.users SET admin_permissions = array_append(admin_permissions, 'people.oversee')
 WHERE role = 'admin' AND 'users.money' = ANY(admin_permissions) AND NOT ('people.oversee' = ANY(admin_permissions));

-- 018: being put in someone's group needs your yes; blocking people.

-- Adding someone to your groups is a request until they accept. Existing people stay as they are.
ALTER TABLE __SCHEMA__.people_members ADD COLUMN IF NOT EXISTS consent TEXT NOT NULL DEFAULT 'accepted' CHECK (consent IN ('pending', 'accepted'));
ALTER TABLE __SCHEMA__.people_members ALTER COLUMN consent SET DEFAULT 'pending';
ALTER TABLE __SCHEMA__.people_members ADD COLUMN IF NOT EXISTS asked_at TIMESTAMPTZ;

-- "Don't let this person add me again."
CREATE TABLE IF NOT EXISTS __SCHEMA__.people_optouts (
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, owner_id)
);

-- A block stops every dealing between two accounts, both ways. by_admin: put by the team.
CREATE TABLE IF NOT EXISTS __SCHEMA__.user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  by_admin UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx ON __SCHEMA__.user_blocks (blocked_id);

ALTER TABLE __SCHEMA__.people_optouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.user_blocks ENABLE ROW LEVEL SECURITY;

-- Cash agents: photos / a short video of the place and written directions, so
-- people find the shop easily; updates to the people they served (or, through
-- the admins, to everyone in their area). People can say which town they live
-- in, so area announcements reach them.

ALTER TABLE __SCHEMA__.agent_profiles ADD COLUMN IF NOT EXISTS media JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE __SCHEMA__.agent_profiles ADD COLUMN IF NOT EXISTS directions TEXT;

ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS home_city TEXT;

CREATE TABLE IF NOT EXISTS __SCHEMA__.agent_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('moved', 'hours', 'closed', 'news')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  -- customers: sent straight away to people who dealt with the agent.
  -- area: a request the admins approve, then everyone in those places gets it.
  audience TEXT NOT NULL CHECK (audience IN ('customers', 'area')),
  places TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'pending', 'rejected')),
  reach INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  decided_by UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  -- Shown on the agent's card on the map until then.
  show_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_posts_agent_idx ON __SCHEMA__.agent_posts (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_posts_pending_idx ON __SCHEMA__.agent_posts (status) WHERE status = 'pending';
ALTER TABLE __SCHEMA__.agent_posts ENABLE ROW LEVEL SECURITY;

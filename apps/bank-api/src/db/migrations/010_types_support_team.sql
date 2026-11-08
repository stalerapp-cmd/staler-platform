-- 010: what kind of customer someone is (personal, business, cash agent), daily limits per kind;
-- support conversations that one staff member takes, hands over and gets rated on; staff leave.

ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS customer_type TEXT NOT NULL DEFAULT 'personal' CHECK (customer_type IN ('personal', 'business', 'agent'));
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS business_name TEXT;
ALTER TABLE __SCHEMA__.pending_users ADD COLUMN IF NOT EXISTS customer_type TEXT NOT NULL DEFAULT 'personal';
ALTER TABLE __SCHEMA__.pending_users ADD COLUMN IF NOT EXISTS business_name TEXT;
INSERT INTO __SCHEMA__.settings (key, value) VALUES ('limit_personal', 'null'), ('limit_business', 'null'), ('limit_agent', 'null') ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS __SCHEMA__.support_threads (
  user_id UUID PRIMARY KEY REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  topic TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  assigned_to UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  first_reply_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
  rating_pending BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_threads_assigned_idx ON __SCHEMA__.support_threads (assigned_to, status);
INSERT INTO __SCHEMA__.support_threads (user_id, status, created_at, updated_at)
  SELECT user_id, 'open', min(created_at), max(created_at) FROM __SCHEMA__.support_messages GROUP BY user_id
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS __SCHEMA__.support_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  admin_id UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
  stars SMALLINT CHECK (stars BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_ratings_admin_idx ON __SCHEMA__.support_ratings (admin_id, created_at DESC);

CREATE TABLE IF NOT EXISTS __SCHEMA__.support_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  from_admin UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
  to_admin UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'replaced')),
  answer TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS support_handoffs_to_idx ON __SCHEMA__.support_handoffs (to_admin, status);

CREATE TABLE IF NOT EXISTS __SCHEMA__.admin_leaves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'leave' CHECK (kind IN ('leave', 'off')),
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'declined', 'cancelled')),
  requested_by UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
  decided_by UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS admin_leaves_admin_idx ON __SCHEMA__.admin_leaves (admin_id, ends_on);

ALTER TABLE __SCHEMA__.support_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.support_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.support_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.admin_leaves ENABLE ROW LEVEL SECURITY;

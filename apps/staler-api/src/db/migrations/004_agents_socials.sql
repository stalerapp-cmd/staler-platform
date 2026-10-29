-- Cash agents (exchange role) are back, with a public profile so customers
-- can find one; stores get social links.

-- Accounts that were cash agents before 003 turned them into personal ones.
UPDATE __SCHEMA__.users SET role = 'exchange', token_version = token_version + 1
 WHERE id IN ('cfa8ffc1-faea-4008-af47-70b8e8cb4229', 'ff1733c2-043d-4ccd-aa84-3d60e65290d4') AND role = 'user';

CREATE TABLE IF NOT EXISTS __SCHEMA__.agent_profiles (
  user_id UUID PRIMARY KEY REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  city TEXT,
  address TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  phone TEXT,
  hours TEXT,
  logo_url TEXT,
  cash_in BOOLEAN NOT NULL DEFAULT true,
  cash_out BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_profiles_status_idx ON __SCHEMA__.agent_profiles (status);

-- A cash-out request: the agent shows a QR, the customer pays it from the
-- wallet, the agent then hands over the cash.
CREATE TABLE IF NOT EXISTS __SCHEMA__.agent_cashouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  secret_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  paid_by UUID REFERENCES __SCHEMA__.users(id),
  paid_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_cashouts_agent_idx ON __SCHEMA__.agent_cashouts (agent_id, created_at DESC);

ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS instagram TEXT;
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS tiktok TEXT;
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS facebook TEXT;

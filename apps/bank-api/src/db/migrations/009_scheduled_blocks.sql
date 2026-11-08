-- 009: scheduled payments (standing orders) that the receiver accepts first, and blocking.

CREATE TABLE IF NOT EXISTS __SCHEMA__.standing_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  from_account_id UUID NOT NULL REFERENCES __SCHEMA__.bank_accounts(id) ON DELETE CASCADE,
  to_account_id UUID NOT NULL REFERENCES __SCHEMA__.bank_accounts(id) ON DELETE CASCADE,
  to_user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  title TEXT,
  category TEXT,
  amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  every TEXT NOT NULL CHECK (every IN ('once', 'week', '2weeks', 'month', 'days')),
  every_days INT CHECK (every_days IS NULL OR every_days BETWEEN 1 AND 365),
  next_run_at TIMESTAMPTZ NOT NULL,
  ends TEXT NOT NULL DEFAULT 'never' CHECK (ends IN ('never', 'until', 'count')),
  end_date DATE,
  max_runs INT CHECK (max_runs IS NULL OR max_runs BETWEEN 1 AND 1000),
  runs INT NOT NULL DEFAULT 0,
  total NUMERIC(20,2) NOT NULL DEFAULT 0,
  auto BOOLEAN NOT NULL DEFAULT true,
  remind_before INT CHECK (remind_before IS NULL OR remind_before BETWEEN 0 AND 30),
  reminded_for TIMESTAMPTZ,
  awaiting BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  consent TEXT NOT NULL DEFAULT 'pending' CHECK (consent IN ('pending', 'accepted')),
  paused_by_admin BOOLEAN NOT NULL DEFAULT false,
  admin_note TEXT,
  fail_count INT NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS standing_orders_due_idx ON __SCHEMA__.standing_orders (next_run_at) WHERE active AND NOT paused_by_admin;
CREATE INDEX IF NOT EXISTS standing_orders_user_idx ON __SCHEMA__.standing_orders (user_id);
CREATE INDEX IF NOT EXISTS standing_orders_to_idx ON __SCHEMA__.standing_orders (to_user_id);

CREATE TABLE IF NOT EXISTS __SCHEMA__.standing_order_runs (
  id BIGSERIAL PRIMARY KEY,
  order_id UUID REFERENCES __SCHEMA__.standing_orders(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  amount NUMERIC(20,2) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('done', 'failed', 'skipped')),
  error TEXT,
  transaction_id UUID,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS standing_order_runs_idx ON __SCHEMA__.standing_order_runs (order_id, ran_at DESC);

-- "Don't let this person set payments to me again."
CREATE TABLE IF NOT EXISTS __SCHEMA__.payee_optouts (
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, owner_id)
);

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

ALTER TABLE __SCHEMA__.standing_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.standing_order_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.payee_optouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.user_blocks ENABLE ROW LEVEL SECURITY;

-- 011: saved beneficiaries (people you send to) and support calls.

CREATE TABLE IF NOT EXISTS __SCHEMA__.beneficiaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES __SCHEMA__.bank_accounts(id) ON DELETE CASCADE,
  nickname TEXT,
  favourite BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, account_id)
);
CREATE INDEX IF NOT EXISTS beneficiaries_owner_idx ON __SCHEMA__.beneficiaries (owner_id);

-- ------------------------------------------------------------------- calls
INSERT INTO __SCHEMA__.settings (key, value) VALUES
  ('call_hours', '{"days":[0,1,2,3,4,6],"from":"09:00","to":"17:00","slot":30}')
ON CONFLICT (key) DO NOTHING;

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

ALTER TABLE __SCHEMA__.beneficiaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.call_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.call_relay ENABLE ROW LEVEL SECURITY;

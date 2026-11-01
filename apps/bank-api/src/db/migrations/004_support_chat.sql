-- In-app support chat: one thread per customer, answered by bank staff.
CREATE TABLE IF NOT EXISTS __SCHEMA__.support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  from_staff BOOLEAN NOT NULL DEFAULT false,
  staff_id UUID REFERENCES __SCHEMA__.users(id),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_messages_user_idx ON __SCHEMA__.support_messages (user_id, created_at);
CREATE INDEX IF NOT EXISTS support_messages_unread_idx ON __SCHEMA__.support_messages (from_staff, read_at) WHERE read_at IS NULL;
ALTER TABLE __SCHEMA__.support_messages ENABLE ROW LEVEL SECURITY;

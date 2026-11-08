-- 012: messages between customers (encrypted at rest), like the S-Taler wallet.
-- The first bank schema (001) already created empty conversations / participants /
-- messages tables; this brings them up to what the messages module needs.
CREATE TABLE IF NOT EXISTS __SCHEMA__.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE __SCHEMA__.conversations ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE __SCHEMA__.conversations ALTER COLUMN type SET DEFAULT 'user_to_user';
ALTER TABLE __SCHEMA__.conversations ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL;
ALTER TABLE __SCHEMA__.conversations ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS __SCHEMA__.conversation_participants (
  conversation_id UUID NOT NULL REFERENCES __SCHEMA__.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ,
  UNIQUE (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS conversation_participants_user_idx ON __SCHEMA__.conversation_participants (user_id);

CREATE TABLE IF NOT EXISTS __SCHEMA__.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES __SCHEMA__.conversations(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES __SCHEMA__.users(id),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE __SCHEMA__.messages ADD COLUMN IF NOT EXISTS reply_to UUID REFERENCES __SCHEMA__.messages(id) ON DELETE SET NULL;
ALTER TABLE __SCHEMA__.messages ADD COLUMN IF NOT EXISTS reactions JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE __SCHEMA__.messages ADD COLUMN IF NOT EXISTS is_edited BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE __SCHEMA__.messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE __SCHEMA__.messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
UPDATE __SCHEMA__.messages SET is_edited = COALESCE(is_edited, false), is_deleted = COALESCE(is_deleted, false) WHERE is_edited IS NULL OR is_deleted IS NULL;
ALTER TABLE __SCHEMA__.messages ALTER COLUMN is_edited SET DEFAULT false;
ALTER TABLE __SCHEMA__.messages ALTER COLUMN is_edited SET NOT NULL;
ALTER TABLE __SCHEMA__.messages ALTER COLUMN is_deleted SET DEFAULT false;
ALTER TABLE __SCHEMA__.messages ALTER COLUMN is_deleted SET NOT NULL;
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON __SCHEMA__.messages (conversation_id, created_at DESC);

ALTER TABLE __SCHEMA__.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.messages ENABLE ROW LEVEL SECURITY;

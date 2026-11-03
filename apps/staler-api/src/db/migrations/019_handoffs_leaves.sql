-- 019: handing a support chat to an admin (who accepts it or asks to move it),
-- admin leave, and locking the API roles out of the public schema.

CREATE TABLE IF NOT EXISTS __SCHEMA__.support_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES __SCHEMA__.conversations(id) ON DELETE CASCADE,
  from_admin UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
  to_admin UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'replaced')),
  answer TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS support_handoffs_to_idx ON __SCHEMA__.support_handoffs (to_admin, status);
CREATE INDEX IF NOT EXISTS support_handoffs_conv_idx ON __SCHEMA__.support_handoffs (conversation_id, created_at DESC);

-- kind: 'leave' (time off) or 'off' (taken off support by the super admin).
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

ALTER TABLE __SCHEMA__.support_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.admin_leaves ENABLE ROW LEVEL SECURITY;

-- The app talks to the database directly; Supabase's public API roles get nothing here.
DO $$
BEGIN
  IF '__SCHEMA__' = 'public' AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

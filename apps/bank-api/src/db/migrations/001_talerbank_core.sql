-- =====================================================================
-- TalerBank — core schema (idempotent, additive only)
-- Works on BOTH: the existing `talerbank` schema already in Supabase,
-- and an empty database. Nothing is dropped, no existing column changes.
-- __SCHEMA__ is replaced by DB_SCHEMA (default: talerbank).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS __SCHEMA__;

-- ---------------------------------------------------------------- users
CREATE TABLE IF NOT EXISTS __SCHEMA__.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'exchange')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending')),
  profile_image TEXT,
  phone TEXT,
  language TEXT DEFAULT 'en',
  email_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS totp_secret_enc TEXT;
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS totp_last_step BIGINT;
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS totp_recovery_hashes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS profile_image TEXT;

-- Back-fill a unique, URL-safe username for legacy rows (used by the Taler-style API paths).
DO $$
DECLARE r RECORD; base TEXT; candidate TEXT; n INT;
BEGIN
  FOR r IN SELECT id, email FROM __SCHEMA__.users WHERE username IS NULL LOOP
    base := lower(regexp_replace(split_part(r.email, '@', 1), '[^a-zA-Z0-9_]', '', 'g'));
    IF base IS NULL OR length(base) < 3 THEN base := 'user' || coalesce(base, ''); END IF;
    base := left(base, 24);
    candidate := base; n := 0;
    WHILE EXISTS (SELECT 1 FROM __SCHEMA__.users WHERE username = candidate) LOOP
      n := n + 1; candidate := base || n::text;
    END LOOP;
    UPDATE __SCHEMA__.users SET username = candidate WHERE id = r.id;
  END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_uq ON __SCHEMA__.users (username);
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq ON __SCHEMA__.users (lower(email));
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'duplicate e-mails differing only by case exist; using a non-unique index';
  CREATE INDEX IF NOT EXISTS users_email_lower_idx ON __SCHEMA__.users (lower(email));
END $$;

-- -------------------------------------------------------- bank_accounts
CREATE TABLE IF NOT EXISTS __SCHEMA__.bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  account_number TEXT UNIQUE NOT NULL,
  iban TEXT UNIQUE,
  currency TEXT NOT NULL DEFAULT 'PS',
  balance NUMERIC(20,2) NOT NULL DEFAULT 0,
  debit_threshold NUMERIC(20,2) DEFAULT 0,
  is_taler_exchange BOOLEAN DEFAULT false,
  is_locked BOOLEAN DEFAULT false,
  payto_uri TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.bank_accounts ADD COLUMN IF NOT EXISTS nickname TEXT;
-- Legacy accounts without a payto URI get one derived from their IBAN.
UPDATE __SCHEMA__.bank_accounts a
   SET payto_uri = 'payto://iban/TALERPS1/' || a.iban || '?receiver-name=' || replace(u.full_name, ' ', '+')
  FROM __SCHEMA__.users u
 WHERE u.id = a.user_id AND a.payto_uri IS NULL AND a.iban IS NOT NULL;
ALTER TABLE __SCHEMA__.bank_accounts ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS bank_accounts_user_idx ON __SCHEMA__.bank_accounts (user_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_accounts_balance_floor'
                 AND conrelid = '__SCHEMA__.bank_accounts'::regclass) THEN
    ALTER TABLE __SCHEMA__.bank_accounts
      ADD CONSTRAINT bank_accounts_balance_floor CHECK (balance >= -COALESCE(debit_threshold, 0)) NOT VALID;
  END IF;
END $$;

-- --------------------------------------------------------- transactions
CREATE TABLE IF NOT EXISTS __SCHEMA__.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_account_id UUID REFERENCES __SCHEMA__.bank_accounts(id),
  to_account_id UUID REFERENCES __SCHEMA__.bank_accounts(id),
  amount NUMERIC(20,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PS',
  type TEXT NOT NULL CHECK (type IN ('transfer','deposit','withdrawal','taler_withdraw','taler_deposit','wire','fee')),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','completed','failed','reversed')),
  subject TEXT,
  reference TEXT UNIQUE DEFAULT gen_random_uuid()::TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.transactions ADD COLUMN IF NOT EXISTS from_balance_after NUMERIC(20,2);
ALTER TABLE __SCHEMA__.transactions ADD COLUMN IF NOT EXISTS to_balance_after NUMERIC(20,2);
ALTER TABLE __SCHEMA__.transactions ADD COLUMN IF NOT EXISTS initiated_by UUID;
ALTER TABLE __SCHEMA__.transactions ADD COLUMN IF NOT EXISTS request_uid TEXT;
ALTER TABLE __SCHEMA__.transactions ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
CREATE UNIQUE INDEX IF NOT EXISTS transactions_request_uid_uq ON __SCHEMA__.transactions (request_uid) WHERE request_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS transactions_from_idx ON __SCHEMA__.transactions (from_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_to_idx ON __SCHEMA__.transactions (to_account_id, created_at DESC);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_amount_positive'
                 AND conrelid = '__SCHEMA__.transactions'::regclass) THEN
    ALTER TABLE __SCHEMA__.transactions ADD CONSTRAINT transactions_amount_positive CHECK (amount > 0) NOT VALID;
  END IF;
END $$;

-- ------------------------------------------------ withdrawal_operations
CREATE TABLE IF NOT EXISTS __SCHEMA__.withdrawal_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::TEXT,
  account_id UUID NOT NULL REFERENCES __SCHEMA__.bank_accounts(id),
  amount NUMERIC(20,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PS',
  reserve_pub TEXT,
  selected_exchange_account TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','selected','confirmed','aborted')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.withdrawal_operations ADD COLUMN IF NOT EXISTS wallet_ref TEXT;
ALTER TABLE __SCHEMA__.withdrawal_operations ADD COLUMN IF NOT EXISTS selected_at TIMESTAMPTZ;
ALTER TABLE __SCHEMA__.withdrawal_operations ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE __SCHEMA__.withdrawal_operations ADD COLUMN IF NOT EXISTS aborted_at TIMESTAMPTZ;
ALTER TABLE __SCHEMA__.withdrawal_operations ADD COLUMN IF NOT EXISTS transaction_id UUID;
ALTER TABLE __SCHEMA__.withdrawal_operations ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT now() + interval '30 minutes';
CREATE INDEX IF NOT EXISTS withdrawal_ops_account_idx ON __SCHEMA__.withdrawal_operations (account_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_ops_reserve_uq ON __SCHEMA__.withdrawal_operations (reserve_pub) WHERE reserve_pub IS NOT NULL;

-- ------------------------------------------------------------- reserves
CREATE TABLE IF NOT EXISTS __SCHEMA__.reserves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reserve_pub TEXT UNIQUE NOT NULL,
  account_id UUID REFERENCES __SCHEMA__.bank_accounts(id),
  amount NUMERIC(20,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PS',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','expired')),
  expiry TIMESTAMPTZ DEFAULT now() + interval '30 days',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.reserves ADD COLUMN IF NOT EXISTS transaction_id UUID;
ALTER TABLE __SCHEMA__.reserves ADD COLUMN IF NOT EXISTS source TEXT;

-- -------------------------------------------------------- denominations
CREATE TABLE IF NOT EXISTS __SCHEMA__.denominations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  currency TEXT NOT NULL DEFAULT 'PS',
  value NUMERIC(20,2) NOT NULL,
  fee_withdraw NUMERIC(20,2) DEFAULT 0,
  fee_deposit NUMERIC(20,2) DEFAULT 0,
  fee_refresh NUMERIC(20,2) DEFAULT 0,
  valid_from TIMESTAMPTZ DEFAULT now(),
  valid_until TIMESTAMPTZ DEFAULT now() + interval '1 year',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO __SCHEMA__.denominations (currency, value)
SELECT 'PS', v FROM unnest(ARRAY[0.01,0.05,0.10,0.50,1,5,10,50,100]::numeric[]) AS v
WHERE NOT EXISTS (SELECT 1 FROM __SCHEMA__.denominations);

-- ------------------------------------------------------- wire_transfers
CREATE TABLE IF NOT EXISTS __SCHEMA__.wire_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_account_id UUID REFERENCES __SCHEMA__.bank_accounts(id),
  to_payto_uri TEXT NOT NULL,
  to_iban TEXT,
  to_name TEXT,
  amount NUMERIC(20,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PS',
  subject TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','completed','failed')),
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.wire_transfers ADD COLUMN IF NOT EXISTS request_uid TEXT;
ALTER TABLE __SCHEMA__.wire_transfers ADD COLUMN IF NOT EXISTS transaction_id UUID;
ALTER TABLE __SCHEMA__.wire_transfers ADD COLUMN IF NOT EXISTS credit_account_id UUID;
ALTER TABLE __SCHEMA__.wire_transfers ADD COLUMN IF NOT EXISTS request_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS wire_transfers_request_uid_uq ON __SCHEMA__.wire_transfers (request_uid) WHERE request_uid IS NOT NULL;

-- ----------------------------------------------------------- qr_sessions
CREATE TABLE IF NOT EXISTS __SCHEMA__.qr_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES __SCHEMA__.users(id),
  account_id UUID REFERENCES __SCHEMA__.bank_accounts(id),
  amount NUMERIC(20,2),
  currency TEXT DEFAULT 'PS',
  description TEXT,
  qr_data TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','paid','expired')),
  paid_by UUID REFERENCES __SCHEMA__.users(id),
  paid_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT now() + interval '15 minutes',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.qr_sessions ADD COLUMN IF NOT EXISTS transaction_id UUID;

-- ---------------------------------------------------- verification_codes
CREATE TABLE IF NOT EXISTS __SCHEMA__.verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('email_verify','reset_password','profile_update','delete_account')),
  expires_at TIMESTAMPTZ DEFAULT now() + interval '15 minutes',
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.verification_codes ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE __SCHEMA__.verification_codes ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE __SCHEMA__.verification_codes ADD COLUMN IF NOT EXISTS payload_enc TEXT;
CREATE INDEX IF NOT EXISTS verification_codes_lookup_idx ON __SCHEMA__.verification_codes (lower(email), type, created_at DESC);

-- --------------------------------------------------------- pending_users
CREATE TABLE IF NOT EXISTS __SCHEMA__.pending_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  verification_code TEXT NOT NULL,
  code_expires_at TIMESTAMPTZ DEFAULT now() + interval '15 minutes',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.pending_users ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE __SCHEMA__.pending_users ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT now() + interval '24 hours';
ALTER TABLE __SCHEMA__.pending_users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE __SCHEMA__.pending_users ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';

-- ------------------------------------------------- messaging (unchanged)
CREATE TABLE IF NOT EXISTS __SCHEMA__.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('support','user_to_user','system')),
  title TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS __SCHEMA__.conversation_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES __SCHEMA__.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ,
  UNIQUE (conversation_id, user_id)
);
CREATE TABLE IF NOT EXISTS __SCHEMA__.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES __SCHEMA__.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES __SCHEMA__.users(id),
  content TEXT NOT NULL,
  is_edited BOOLEAN DEFAULT false,
  is_deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- --------------------------------------------------------- notifications
CREATE TABLE IF NOT EXISTS __SCHEMA__.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  is_read BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON __SCHEMA__.notifications (user_id, is_read, created_at DESC);

-- -------------------------------------------------------------- settings
CREATE TABLE IF NOT EXISTS __SCHEMA__.settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO __SCHEMA__.settings (key, value) VALUES
  ('currency', '"PS"'), ('currency_name', '"Palestinian Shekel"'), ('bank_name', '"TalerBank"'),
  ('bank_bic', '"TALERPS1"'), ('max_transfer', '10000'), ('min_transfer', '0.01'),
  ('registration_bonus', '0'), ('maintenance_mode', 'false'), ('allow_registrations', 'true'),
  ('allow_deletions', 'true'), ('exchange_fee_percent', '0'), ('wire_fee_fixed', '0')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------- audit_log
CREATE TABLE IF NOT EXISTS __SCHEMA__.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES __SCHEMA__.users(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.audit_log ADD COLUMN IF NOT EXISTS user_agent TEXT;
CREATE INDEX IF NOT EXISTS audit_log_user_idx ON __SCHEMA__.audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON __SCHEMA__.audit_log (created_at DESC);

-- =====================================================================
-- New security tables
-- =====================================================================
CREATE TABLE IF NOT EXISTS __SCHEMA__.refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  family_id UUID NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  family_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  replaced_by UUID,
  user_agent TEXT,
  ip_address TEXT,
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON __SCHEMA__.refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx ON __SCHEMA__.refresh_tokens (family_id);

-- Scoped tokens that let a third-party app (S-Taler wallet) act on ONE account with limited rights.
CREATE TABLE IF NOT EXISTS __SCHEMA__.api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES __SCHEMA__.bank_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL,
  client_name TEXT NOT NULL,
  description TEXT,
  per_operation_limit NUMERIC(20,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS api_tokens_user_idx ON __SCHEMA__.api_tokens (user_id);

-- One-time codes a customer generates in the bank to link an external wallet without sharing the password.
CREATE TABLE IF NOT EXISTS __SCHEMA__.link_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES __SCHEMA__.bank_accounts(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS __SCHEMA__.idempotency_keys (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

-- ------------------------------------------------------ updated_at trigger
CREATE OR REPLACE FUNCTION __SCHEMA__.update_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_users_updated_at BEFORE UPDATE ON __SCHEMA__.users
  FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.update_updated_at();
CREATE OR REPLACE TRIGGER trg_accounts_updated_at BEFORE UPDATE ON __SCHEMA__.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.update_updated_at();
CREATE OR REPLACE TRIGGER trg_withdrawals_updated_at BEFORE UPDATE ON __SCHEMA__.withdrawal_operations
  FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.update_updated_at();

-- =====================================================================
-- Lock the schema down: only this API (table owner) may touch it.
-- Supabase's auto-generated REST API (anon / authenticated roles) is cut off.
-- =====================================================================
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = '__SCHEMA__' LOOP
    EXECUTE format('ALTER TABLE __SCHEMA__.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA __SCHEMA__ FROM anon';
    EXECUTE 'REVOKE USAGE ON SCHEMA __SCHEMA__ FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA __SCHEMA__ FROM authenticated';
    EXECUTE 'REVOKE USAGE ON SCHEMA __SCHEMA__ FROM authenticated';
  END IF;
END $$;

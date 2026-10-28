-- The talerbank schema exactly as the original setup script created it in Supabase
-- (15 tables, default admin with the published hash, exchange account),
-- plus one legacy customer with a bcrypt password and an existing balance.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS talerbank;

CREATE TABLE talerbank.users (
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
CREATE TABLE talerbank.bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES talerbank.users(id) ON DELETE CASCADE,
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
CREATE TABLE talerbank.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_account_id UUID REFERENCES talerbank.bank_accounts(id),
  to_account_id UUID REFERENCES talerbank.bank_accounts(id),
  amount NUMERIC(20,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PS',
  type TEXT NOT NULL CHECK (type IN ('transfer','deposit','withdrawal','taler_withdraw','taler_deposit','wire','fee')),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','completed','failed','reversed')),
  subject TEXT,
  reference TEXT UNIQUE DEFAULT gen_random_uuid()::TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE talerbank.withdrawal_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::TEXT,
  account_id UUID NOT NULL REFERENCES talerbank.bank_accounts(id),
  amount NUMERIC(20,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PS',
  reserve_pub TEXT,
  selected_exchange_account TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','selected','confirmed','aborted')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE talerbank.reserves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reserve_pub TEXT UNIQUE NOT NULL,
  account_id UUID REFERENCES talerbank.bank_accounts(id),
  amount NUMERIC(20,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PS',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','expired')),
  expiry TIMESTAMPTZ DEFAULT now() + interval '30 days',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE talerbank.denominations (
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
CREATE TABLE talerbank.wire_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_account_id UUID REFERENCES talerbank.bank_accounts(id),
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
CREATE TABLE talerbank.qr_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES talerbank.users(id),
  account_id UUID REFERENCES talerbank.bank_accounts(id),
  amount NUMERIC(20,2),
  currency TEXT DEFAULT 'PS',
  description TEXT,
  qr_data TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','paid','expired')),
  paid_by UUID REFERENCES talerbank.users(id),
  paid_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT now() + interval '15 minutes',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE talerbank.verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('email_verify','reset_password','profile_update','delete_account')),
  expires_at TIMESTAMPTZ DEFAULT now() + interval '15 minutes',
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE talerbank.pending_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  verification_code TEXT NOT NULL,
  code_expires_at TIMESTAMPTZ DEFAULT now() + interval '15 minutes',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE talerbank.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('support','user_to_user','system')),
  title TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE talerbank.conversation_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES talerbank.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES talerbank.users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ,
  UNIQUE(conversation_id, user_id)
);
CREATE TABLE talerbank.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES talerbank.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES talerbank.users(id),
  content TEXT NOT NULL,
  is_edited BOOLEAN DEFAULT false,
  is_deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE talerbank.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES talerbank.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  is_read BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE talerbank.settings (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE talerbank.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES talerbank.users(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE FUNCTION talerbank.update_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON talerbank.users FOR EACH ROW EXECUTE FUNCTION talerbank.update_updated_at();
CREATE TRIGGER trg_accounts_updated_at BEFORE UPDATE ON talerbank.bank_accounts FOR EACH ROW EXECUTE FUNCTION talerbank.update_updated_at();

INSERT INTO talerbank.settings (key, value) VALUES ('currency','"PS"'), ('allow_registrations','true'), ('maintenance_mode','false');

INSERT INTO talerbank.users (full_name, email, password_hash, role, status, email_verified)
VALUES ('System Admin', 'admin@talerbank.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCgZvxa8jB4bP.7.1nxJO6e', 'admin', 'active', true);
INSERT INTO talerbank.bank_accounts (user_id, account_number, iban, currency, balance)
VALUES ((SELECT id FROM talerbank.users WHERE email = 'admin@talerbank.local'), 'TB0000000001', 'DE00000000000000000000', 'PS', 0);

INSERT INTO talerbank.users (full_name, email, password_hash, role, status, email_verified)
VALUES ('Taler Exchange', 'exchange@talerbank.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCgZvxa8jB4bP.7.1nxJO6e', 'exchange', 'active', true);
INSERT INTO talerbank.bank_accounts (user_id, account_number, iban, currency, balance, is_taler_exchange, payto_uri)
VALUES ((SELECT id FROM talerbank.users WHERE email = 'exchange@talerbank.local'), 'EXCHANGE001', 'DE97180549512869831080', 'PS', 0, true,
        'payto://iban/TALERPS1/DE97180549512869831080?receiver-name=Taler+Exchange+Account');

-- A real legacy customer (bcrypt password "Legacy!Pass123", 250.00 PS balance)
INSERT INTO talerbank.users (full_name, email, password_hash, role, status, email_verified)
VALUES ('Legacy Customer', 'legacy.user@example.com', '$2a$10$QgniYYhvToHV/tx0nie4BuoD6v/tB4NdBn0rKSxUFMav.f7mSuLUG', 'user', 'active', true);
INSERT INTO talerbank.bank_accounts (user_id, account_number, iban, currency, balance)
VALUES ((SELECT id FROM talerbank.users WHERE email = 'legacy.user@example.com'), 'TB1234567890', 'PS13TLRB000000000000000000001', 'PS', 250.00);

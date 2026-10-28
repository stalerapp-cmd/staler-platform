-- =====================================================================
-- S-Taler — core schema (idempotent, additive only)
-- Upgrades the EXISTING Supabase tables in place (24 tables used by the
-- old backend) and creates them from scratch on an empty database.
-- Nothing is dropped. __SCHEMA__ = DB_SCHEMA (default: public).
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------- users
CREATE TABLE IF NOT EXISTS __SCHEMA__.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  admin_level TEXT,
  profile_image TEXT,
  phone_number TEXT,
  verification_method TEXT DEFAULT 'email',
  email_verified BOOLEAN DEFAULT false,
  phone_verified BOOLEAN DEFAULT false,
  email_verified_at TIMESTAMPTZ,
  phone_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS admin_level TEXT;
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS profile_image TEXT;
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
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
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_allowed' AND conrelid = '__SCHEMA__.users'::regclass) THEN
    ALTER TABLE __SCHEMA__.users ADD CONSTRAINT users_role_allowed CHECK (role IN ('user','merchant','exchange','admin')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_status_allowed' AND conrelid = '__SCHEMA__.users'::regclass) THEN
    ALTER TABLE __SCHEMA__.users ADD CONSTRAINT users_status_allowed CHECK (status IN ('active','suspended')) NOT VALID;
  END IF;
END $$;
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq ON __SCHEMA__.users (lower(email));
EXCEPTION WHEN unique_violation THEN
  CREATE INDEX IF NOT EXISTS users_email_lower_idx ON __SCHEMA__.users (lower(email));
END $$;

-- --------------------------------------------------------------- wallets
CREATE TABLE IF NOT EXISTS __SCHEMA__.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  wallet_id TEXT UNIQUE NOT NULL,
  balance NUMERIC(20,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'PS',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.wallets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE __SCHEMA__.wallets ADD COLUMN IF NOT EXISTS is_frozen BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS wallets_user_idx ON __SCHEMA__.wallets (user_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wallets_balance_non_negative' AND conrelid = '__SCHEMA__.wallets'::regclass) THEN
    ALTER TABLE __SCHEMA__.wallets ADD CONSTRAINT wallets_balance_non_negative CHECK (balance >= 0) NOT VALID;
  END IF;
END $$;

-- ---------------------------------------------------------- transactions
CREATE TABLE IF NOT EXISTS __SCHEMA__.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
  wallet_id TEXT,
  transaction_type TEXT NOT NULL,
  amount NUMERIC(20,2) NOT NULL,
  currency TEXT DEFAULT 'PS',
  status TEXT DEFAULT 'completed',
  description TEXT,
  from_account TEXT,
  to_account TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.transactions ADD COLUMN IF NOT EXISTS reference UUID;
ALTER TABLE __SCHEMA__.transactions ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE __SCHEMA__.transactions ADD COLUMN IF NOT EXISTS counterparty_name TEXT;
ALTER TABLE __SCHEMA__.transactions ADD COLUMN IF NOT EXISTS balance_after NUMERIC(20,2);
CREATE INDEX IF NOT EXISTS transactions_wallet_created_idx ON __SCHEMA__.transactions (wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_user_created_idx ON __SCHEMA__.transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_reference_idx ON __SCHEMA__.transactions (reference);

-- ------------------------------------------------------- pending_users
CREATE TABLE IF NOT EXISTS __SCHEMA__.pending_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  phone_number TEXT,
  verification_method TEXT DEFAULT 'email',
  verification_code TEXT,
  code_expires_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.pending_users ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE __SCHEMA__.pending_users ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';

CREATE TABLE IF NOT EXISTS __SCHEMA__.password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  email TEXT,
  reset_code TEXT NOT NULL,
  used BOOLEAN DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.password_resets ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS __SCHEMA__.profile_update_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  verification_code TEXT NOT NULL,
  update_type TEXT,
  new_value TEXT,
  pending_changes JSONB DEFAULT '{}',
  expires_at TIMESTAMPTZ NOT NULL,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.profile_update_verifications ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
-- The old backend stored the NEW PASSWORD IN PLAIN TEXT inside pending_changes. Wipe it.
UPDATE __SCHEMA__.profile_update_verifications
   SET pending_changes = pending_changes - 'newPassword', verified = true
 WHERE pending_changes ? 'newPassword';

CREATE TABLE IF NOT EXISTS __SCHEMA__.account_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  deletion_code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.account_deletion_requests ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

-- ------------------------------------------- bank link (wallet <-> bank)
CREATE TABLE IF NOT EXISTS __SCHEMA__.bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  wallet_id UUID REFERENCES __SCHEMA__.wallets(id) ON DELETE CASCADE,
  bank_username TEXT,
  bank_password_enc TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.bank_accounts ADD COLUMN IF NOT EXISTS bank_password_enc TEXT;
ALTER TABLE __SCHEMA__.bank_accounts ADD COLUMN IF NOT EXISTS bank_token_enc TEXT;
ALTER TABLE __SCHEMA__.bank_accounts ADD COLUMN IF NOT EXISTS bank_token_expires_at TIMESTAMPTZ;
ALTER TABLE __SCHEMA__.bank_accounts ADD COLUMN IF NOT EXISTS bank_iban TEXT;
ALTER TABLE __SCHEMA__.bank_accounts ADD COLUMN IF NOT EXISTS bank_holder TEXT;
ALTER TABLE __SCHEMA__.bank_accounts ADD COLUMN IF NOT EXISTS bank_payto TEXT;
ALTER TABLE __SCHEMA__.bank_accounts ADD COLUMN IF NOT EXISTS linked_via TEXT;
ALTER TABLE __SCHEMA__.bank_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
-- Relax legacy NOT NULLs so stored bank passwords can be erased.
DO $$
DECLARE col TEXT;
BEGIN
  FOREACH col IN ARRAY ARRAY['bank_password_enc','bank_password_hash','bank_username'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = '__SCHEMA__' AND table_name = 'bank_accounts'
               AND column_name = col AND is_nullable = 'NO') THEN
      EXECUTE format('ALTER TABLE __SCHEMA__.bank_accounts ALTER COLUMN %I DROP NOT NULL', col);
    END IF;
  END LOOP;
END $$;
-- SECURITY CLEAN-UP: the old backend stored users' BANK PASSWORDS (reversibly encrypted).
-- Those links pointed at the retired LibEuFin bank anyway — erase them; users re-link with a scoped token.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = '__SCHEMA__' AND table_name = 'bank_accounts' AND column_name = 'bank_password_hash') THEN
    EXECUTE 'UPDATE __SCHEMA__.bank_accounts SET bank_password_hash = NULL WHERE bank_password_hash IS NOT NULL';
  END IF;
END $$;
UPDATE __SCHEMA__.bank_accounts SET bank_password_enc = NULL, status = 'inactive'
 WHERE bank_password_enc IS NOT NULL OR (bank_token_enc IS NULL AND status = 'active');

-- ------------------------------------------------------------- reserves
CREATE TABLE IF NOT EXISTS __SCHEMA__.reserves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID REFERENCES __SCHEMA__.wallets(id) ON DELETE CASCADE,
  reserve_pub TEXT NOT NULL,
  reserve_priv TEXT,
  amount NUMERIC(20,2) NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.reserves ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE __SCHEMA__.reserves ADD COLUMN IF NOT EXISTS bank_reference TEXT;
CREATE INDEX IF NOT EXISTS reserves_wallet_idx ON __SCHEMA__.reserves (wallet_id, created_at DESC);

-- ----------------------------------------------------------- marketplace
CREATE TABLE IF NOT EXISTS __SCHEMA__.merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  store_name TEXT NOT NULL,
  description TEXT,
  wallet_id UUID REFERENCES __SCHEMA__.wallets(id),
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE TABLE IF NOT EXISTS __SCHEMA__.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES __SCHEMA__.merchants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(20,2) NOT NULL,
  image_url TEXT,
  stock INTEGER DEFAULT 0,
  is_digital BOOLEAN DEFAULT false,
  digital_file_url TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.products ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE __SCHEMA__.products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_price_positive' AND conrelid = '__SCHEMA__.products'::regclass) THEN
    ALTER TABLE __SCHEMA__.products ADD CONSTRAINT products_price_positive CHECK (price > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_stock_non_negative' AND conrelid = '__SCHEMA__.products'::regclass) THEN
    ALTER TABLE __SCHEMA__.products ADD CONSTRAINT products_stock_non_negative CHECK (stock >= 0) NOT VALID;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS products_merchant_idx ON __SCHEMA__.products (merchant_id);

CREATE TABLE IF NOT EXISTS __SCHEMA__.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
  merchant_id UUID REFERENCES __SCHEMA__.merchants(id) ON DELETE SET NULL,
  total_amount NUMERIC(20,2) NOT NULL,
  status TEXT DEFAULT 'pending',
  payment_status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS escrow_status TEXT;
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS checkout_ref UUID;
CREATE INDEX IF NOT EXISTS orders_user_idx ON __SCHEMA__.orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_merchant_idx ON __SCHEMA__.orders (merchant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS __SCHEMA__.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES __SCHEMA__.orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES __SCHEMA__.products(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL,
  price NUMERIC(20,2) NOT NULL,
  is_digital BOOLEAN DEFAULT false,
  digital_file_url TEXT
);
ALTER TABLE __SCHEMA__.order_items ADD COLUMN IF NOT EXISTS product_name TEXT;
CREATE INDEX IF NOT EXISTS order_items_order_idx ON __SCHEMA__.order_items (order_id);
-- Derive the escrow state of orders created by the old backend.
UPDATE __SCHEMA__.orders o SET escrow_status = CASE
    WHEN o.status = 'cancelled' THEN 'refunded'
    WHEN o.status = 'completed' THEN 'released'
    WHEN EXISTS (SELECT 1 FROM __SCHEMA__.order_items i WHERE i.order_id = o.id AND i.is_digital) THEN 'released'
    ELSE 'held' END
 WHERE o.escrow_status IS NULL AND o.payment_status = 'completed';

-- ------------------------------------------------------------- messaging
CREATE TABLE IF NOT EXISTS __SCHEMA__.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  title TEXT,
  status TEXT DEFAULT 'active',
  created_by UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS __SCHEMA__.conversation_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES __SCHEMA__.conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS conv_participants_user_idx ON __SCHEMA__.conversation_participants (user_id);
CREATE INDEX IF NOT EXISTS conv_participants_conv_idx ON __SCHEMA__.conversation_participants (conversation_id);
CREATE TABLE IF NOT EXISTS __SCHEMA__.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES __SCHEMA__.conversations(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  is_edited BOOLEAN DEFAULT false,
  edited_at TIMESTAMPTZ,
  is_deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS messages_conv_created_idx ON __SCHEMA__.messages (conversation_id, created_at);

-- -------------------------------------------------------------- settings
CREATE TABLE IF NOT EXISTS __SCHEMA__.system_settings (
  id INTEGER PRIMARY KEY,
  site_name TEXT,
  currency TEXT,
  bank_url TEXT,
  theme TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE __SCHEMA__.system_settings ADD COLUMN IF NOT EXISTS maintenance_mode BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE __SCHEMA__.system_settings ADD COLUMN IF NOT EXISTS allow_registrations BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE __SCHEMA__.system_settings ADD COLUMN IF NOT EXISTS announcement TEXT;
INSERT INTO __SCHEMA__.system_settings (id, site_name, currency, theme) VALUES (1, 'S-Taler', 'PS', 'emerald')
ON CONFLICT (id) DO NOTHING;

-- =====================================================================
-- New tables. Their foreign keys adopt whatever id type the legacy
-- tables really use (UUID or integer), discovered at migration time.
-- =====================================================================
DO $$
DECLARE
  uid TEXT := (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
               WHERE a.attrelid = '__SCHEMA__.users'::regclass AND a.attname = 'id');
  wid TEXT := (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
               WHERE a.attrelid = '__SCHEMA__.wallets'::regclass AND a.attname = 'id');
BEGIN
  EXECUTE format($f$
    CREATE TABLE IF NOT EXISTS __SCHEMA__.refresh_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id %1$s NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
      family_id UUID NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      family_expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      replaced_by UUID,
      user_agent TEXT,
      ip_address TEXT,
      last_used_at TIMESTAMPTZ)$f$, uid);

  EXECUTE format($f$
    CREATE TABLE IF NOT EXISTS __SCHEMA__.audit_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id %1$s REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      details JSONB DEFAULT '{}',
      ip_address TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now())$f$, uid);

  EXECUTE format($f$
    CREATE TABLE IF NOT EXISTS __SCHEMA__.notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id %1$s NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      is_read BOOLEAN NOT NULL DEFAULT false,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now())$f$, uid);

  -- Every call into the bank is first written here, so a crash between "bank
  -- said OK" and "wallet credited" is always recovered by the reconciler.
  EXECUTE format($f$
    CREATE TABLE IF NOT EXISTS __SCHEMA__.bank_operations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id %1$s NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
      wallet_ref %2$s NOT NULL REFERENCES __SCHEMA__.wallets(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('link_withdraw','qr_withdraw','deposit')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','aborted')),
      amount NUMERIC(20,2),
      request_uid TEXT UNIQUE,
      bank_operation_id TEXT UNIQUE,
      reserve_pub TEXT,
      reserve_priv_enc TEXT,
      bank_iban TEXT,
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ)$f$, uid, wid);

  EXECUTE format($f$
    CREATE TABLE IF NOT EXISTS __SCHEMA__.exchange_vouchers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      exchange_user_id %1$s NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
      amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
      description TEXT,
      secret_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','claimed','cancelled')),
      claimed_by %1$s REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
      claimed_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now())$f$, uid);

  EXECUTE format($f$
    CREATE TABLE IF NOT EXISTS __SCHEMA__.stored_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id %1$s REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
      bucket TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      data BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now())$f$, uid);
END $$;

CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON __SCHEMA__.refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx ON __SCHEMA__.refresh_tokens (family_id);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON __SCHEMA__.audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON __SCHEMA__.notifications (user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS bank_operations_status_idx ON __SCHEMA__.bank_operations (status, created_at);
CREATE INDEX IF NOT EXISTS bank_operations_user_idx ON __SCHEMA__.bank_operations (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS __SCHEMA__.idempotency_keys (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

CREATE TABLE IF NOT EXISTS __SCHEMA__.webhook_events (
  id TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- updated_at trigger
CREATE OR REPLACE FUNCTION __SCHEMA__.staler_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE TRIGGER trg_staler_users_touch BEFORE UPDATE ON __SCHEMA__.users FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.staler_touch_updated_at();
CREATE OR REPLACE TRIGGER trg_staler_wallets_touch BEFORE UPDATE ON __SCHEMA__.wallets FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.staler_touch_updated_at();
CREATE OR REPLACE TRIGGER trg_staler_orders_touch BEFORE UPDATE ON __SCHEMA__.orders FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.staler_touch_updated_at();
CREATE OR REPLACE TRIGGER trg_staler_bankops_touch BEFORE UPDATE ON __SCHEMA__.bank_operations FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.staler_touch_updated_at();

-- =====================================================================
-- Close Supabase's public REST API (anon/authenticated) over these tables:
-- only this backend (table owner) may read or write them.
-- =====================================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','wallets','transactions','pending_users','password_resets','profile_update_verifications',
    'account_deletion_requests','bank_accounts','reserves','merchants','products','orders','order_items','conversations',
    'conversation_participants','messages','system_settings','refresh_tokens','audit_log','notifications','bank_operations',
    'exchange_vouchers','stored_files','idempotency_keys','webhook_events'] LOOP
    EXECUTE format('ALTER TABLE __SCHEMA__.%I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON __SCHEMA__.%I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON __SCHEMA__.%I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;

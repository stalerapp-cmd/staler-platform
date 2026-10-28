-- Reconstruction of the S-Taler tables as the OLD backend used them (columns
-- taken from every .from('…') call in the old code), with realistic legacy data:
-- bcrypt passwords, a stored (encrypted) bank password, a plaintext reserve key,
-- an AES-CBC message, a product with a private digital file, a plaintext new
-- password inside profile_update_verifications, and a paid physical order.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.users (
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
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  wallet_id TEXT UNIQUE NOT NULL,
  balance NUMERIC(15,2) DEFAULT 0,
  currency TEXT DEFAULT 'PS',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  wallet_id TEXT,
  transaction_type TEXT NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  currency TEXT DEFAULT 'PS',
  status TEXT DEFAULT 'pending',
  description TEXT,
  from_account TEXT,
  to_account TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE public.pending_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  phone_number TEXT,
  verification_method TEXT,
  verification_code TEXT,
  code_expires_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE public.password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  email TEXT,
  reset_code TEXT,
  used BOOLEAN DEFAULT false,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE public.profile_update_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  verification_code TEXT,
  update_type TEXT,
  new_value TEXT,
  pending_changes JSONB,
  expires_at TIMESTAMP,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE public.account_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  deletion_code TEXT,
  expires_at TIMESTAMPTZ,
  confirmed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE public.bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  wallet_id UUID REFERENCES public.wallets(id) ON DELETE CASCADE,
  bank_username TEXT NOT NULL,
  bank_password_enc TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE public.reserves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID REFERENCES public.wallets(id) ON DELETE CASCADE,
  reserve_pub TEXT NOT NULL,
  reserve_priv TEXT,
  amount NUMERIC(15,2),
  status TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE public.merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  store_name TEXT NOT NULL,
  description TEXT,
  wallet_id UUID REFERENCES public.wallets(id),
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES public.merchants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(15,2) NOT NULL,
  image_url TEXT,
  stock INTEGER DEFAULT 0,
  is_digital BOOLEAN DEFAULT false,
  digital_file_url TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id),
  merchant_id UUID REFERENCES public.merchants(id),
  total_amount NUMERIC(15,2),
  status TEXT DEFAULT 'pending',
  payment_status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id),
  quantity INTEGER,
  price NUMERIC(15,2),
  is_digital BOOLEAN DEFAULT false,
  digital_file_url TEXT
);
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT,
  title TEXT,
  status TEXT DEFAULT 'active',
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE public.conversation_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ
);
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES public.users(id),
  content TEXT,
  is_edited BOOLEAN DEFAULT false,
  edited_at TIMESTAMPTZ,
  is_deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE public.system_settings (
  id INTEGER PRIMARY KEY,
  site_name TEXT,
  currency TEXT,
  bank_url TEXT,
  theme TEXT,
  updated_at TIMESTAMPTZ
);
CREATE OR REPLACE FUNCTION public.wallet_increment_balance(p_wallet_id TEXT, p_amount NUMERIC)
RETURNS public.wallets AS $$
  UPDATE public.wallets SET balance = balance + p_amount WHERE wallet_id = p_wallet_id RETURNING *;
$$ LANGUAGE sql;

-- ------------------------------------------------------------- legacy data
INSERT INTO public.system_settings (id, site_name, currency, bank_url, theme) VALUES (1, 'S-Taler', 'PS', 'http://localhost:8080', 'emerald');

INSERT INTO public.users (id, email, password_hash, full_name, role, email_verified)
VALUES ('11111111-1111-4111-8111-111111111111', 'old.user@example.com', '$2a$10$bQDn6PKGE.RUjcX3CH5G5OeoOaqDug4rl6SOQVfvxAc1doHvsIWKa', 'Old Wallet User', 'user', true),
       ('22222222-2222-4222-8222-222222222222', 'old.merchant@example.com', '$2a$10$bQDn6PKGE.RUjcX3CH5G5OeoOaqDug4rl6SOQVfvxAc1doHvsIWKa', 'Old Merchant', 'merchant', true),
       ('33333333-3333-4333-8333-333333333333', 'old.admin@example.com', '$2a$10$bQDn6PKGE.RUjcX3CH5G5OeoOaqDug4rl6SOQVfvxAc1doHvsIWKa', 'Old Admin', 'admin', true);
UPDATE public.users SET admin_level = 'admin' WHERE id = '33333333-3333-4333-8333-333333333333';

INSERT INTO public.wallets (id, user_id, wallet_id, balance) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'wallet_old12345', 300.00),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'merchant_1700000000000_abcdefghi', 50.00);
-- (the old admin had no wallet — bootstrap must create one)

INSERT INTO public.transactions (user_id, wallet_id, transaction_type, amount, status, description)
VALUES ('11111111-1111-4111-8111-111111111111', 'wallet_old12345', 'withdraw', 300.00, 'completed', 'Bank withdrawal (row_id: 7)');

INSERT INTO public.bank_accounts (user_id, wallet_id, bank_username, bank_password_enc, status)
VALUES ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'olduser', 'c29tZWl2c29tZWl2c29tZQ==:ZW5jcnlwdGVkLXBhc3N3b3Jk', 'active');

INSERT INTO public.reserves (wallet_id, reserve_pub, reserve_priv, amount, status)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ABCDEFGHJKMNPQRSTVWXYZ0123456789ABCDEFGHJKMNPQRSTVWX', 'PLAINTEXTPRIVATEKEY', 300.00, 'active');

INSERT INTO public.profile_update_verifications (user_id, verification_code, update_type, pending_changes, expires_at, verified)
VALUES ('11111111-1111-4111-8111-111111111111', '123456', 'password', '{"newPassword":"MyPlainTextPassword1!"}', now() + interval '1 hour', false);

INSERT INTO public.merchants (id, user_id, store_name, description, wallet_id)
VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '22222222-2222-4222-8222-222222222222', 'Old Bookshop', 'Books and e-books', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
INSERT INTO public.products (id, merchant_id, name, description, price, stock, is_digital, digital_file_url) VALUES
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Secret E-Book', 'PDF', 15.00, 0, true, '22222222-2222-4222-8222-222222222222/secret-ebook.pdf'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Printed Atlas', 'Hardcover', 40.00, 5, false, NULL);

INSERT INTO public.orders (id, user_id, merchant_id, total_amount, status, payment_status)
VALUES ('ffffffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 40.00, 'processing', 'completed');
INSERT INTO public.order_items (order_id, product_id, quantity, price, is_digital) VALUES ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 1, 40.00, false);

INSERT INTO public.conversations (id, type, title, created_by) VALUES ('99999999-9999-4999-8999-999999999999', 'direct', NULL, '11111111-1111-4111-8111-111111111111');
INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES
  ('99999999-9999-4999-8999-999999999999', '11111111-1111-4111-8111-111111111111'),
  ('99999999-9999-4999-8999-999999999999', '22222222-2222-4222-8222-222222222222');
INSERT INTO public.messages (conversation_id, sender_id, content) VALUES
  ('99999999-9999-4999-8999-999999999999', '22222222-2222-4222-8222-222222222222', 'ENC|f5c10dbaa369f21cc37d681599892186|5bb5307868b3e325aa54c57073972c055d27549dbb81cbee2dd513c2b62206e9');

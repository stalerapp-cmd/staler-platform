-- SMS verification for sign-up and "Continue with Google".
ALTER TABLE talerbank.pending_users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE talerbank.pending_users ADD COLUMN IF NOT EXISTS verification_method TEXT NOT NULL DEFAULT 'email';
ALTER TABLE talerbank.users ADD COLUMN IF NOT EXISTS phone TEXT;

-- The person's chosen look follows their account to every device.
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS theme TEXT CHECK (theme IN ('light', 'dark'));

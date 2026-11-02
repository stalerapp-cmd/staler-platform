-- Sign-up codes by Telegram: the bot link carries a one-time token; once the
-- person presses Start, we know their chat and send the code there.
ALTER TABLE __SCHEMA__.pending_users ADD COLUMN IF NOT EXISTS telegram_token TEXT;
ALTER TABLE __SCHEMA__.pending_users ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS pending_users_telegram_token_idx ON __SCHEMA__.pending_users (telegram_token) WHERE telegram_token IS NOT NULL;
ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT;

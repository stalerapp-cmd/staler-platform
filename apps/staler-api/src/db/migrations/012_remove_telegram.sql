-- The Telegram sign-up option was removed; drop its columns.
DROP INDEX IF EXISTS __SCHEMA__.pending_users_telegram_token_idx;
ALTER TABLE __SCHEMA__.pending_users DROP COLUMN IF EXISTS telegram_token;
ALTER TABLE __SCHEMA__.pending_users DROP COLUMN IF EXISTS telegram_chat_id;
ALTER TABLE __SCHEMA__.users DROP COLUMN IF EXISTS telegram_chat_id;

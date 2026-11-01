-- A cash voucher can be locked to the wallet of the person standing at the counter,
-- so a photographed or leaked QR is worthless to anyone else.
ALTER TABLE __SCHEMA__.exchange_vouchers ADD COLUMN IF NOT EXISTS for_user_id UUID REFERENCES __SCHEMA__.users(id);
ALTER TABLE __SCHEMA__.exchange_vouchers ADD COLUMN IF NOT EXISTS for_label TEXT;

-- The apps talk to Postgres as the owner; Supabase's public REST API must see nothing.
-- Row level security with no policies closes every table to it — including ones added later by earlier migrations.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = '__SCHEMA__' LOOP
    EXECUTE format('ALTER TABLE __SCHEMA__.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

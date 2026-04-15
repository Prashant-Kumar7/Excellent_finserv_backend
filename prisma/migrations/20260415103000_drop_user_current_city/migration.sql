-- Remove deprecated current_city from users.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) THEN
    RETURN;
  END IF;

  ALTER TABLE "users" DROP COLUMN IF EXISTS "current_city";
END $$;

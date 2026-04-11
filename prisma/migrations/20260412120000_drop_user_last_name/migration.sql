-- Single full name in `users.name`; drop legacy `last_name` when the table exists
-- (empty / not-yet-provisioned DBs may have no `users` table — unguarded ALTER fails with 42P01).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'users'
  ) THEN
    ALTER TABLE "users" DROP COLUMN IF EXISTS "last_name";
  END IF;
END $$;

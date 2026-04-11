DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'users'
  ) THEN
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "dob" TIMESTAMP(3);
  END IF;
END $$;

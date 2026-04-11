-- AlterTable (guarded for shadow DB replay when `users` is not created by migrations)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'users'
  ) THEN
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "current_district" TEXT;
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "permanent_district" TEXT;
  END IF;
END $$;

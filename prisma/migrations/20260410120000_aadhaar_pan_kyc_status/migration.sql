-- Per-method DigiLocker status (1 = verified, 2 = failed). Legacy `kyc_status` is not updated by new webhooks.
-- Guard: empty shadow DBs (baseline has no DDL) do not have `users` yet.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'users'
  ) THEN
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "aadhaar_kyc_status" INTEGER;
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pan_kyc_status" INTEGER;
  END IF;
END $$;

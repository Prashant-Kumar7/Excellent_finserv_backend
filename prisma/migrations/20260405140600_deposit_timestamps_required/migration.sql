-- Backfill rows created before server started setting timestamps (e.g. Cashfree deposits).
-- Wrapped: baseline migration created no tables, so shadow DBs have no `deposits` until
-- `db push` / manual schema — without this guard, `migrate dev` fails with P1014.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'deposits'
  ) THEN
    UPDATE "deposits" SET "created_at" = CURRENT_TIMESTAMP WHERE "created_at" IS NULL;
    UPDATE "deposits"
    SET "updated_at" = COALESCE("updated_at", "created_at", CURRENT_TIMESTAMP)
    WHERE "updated_at" IS NULL;

    ALTER TABLE "deposits" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE "deposits" ALTER COLUMN "created_at" SET NOT NULL;

    ALTER TABLE "deposits" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE "deposits" ALTER COLUMN "updated_at" SET NOT NULL;
  END IF;
END $$;

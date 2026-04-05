-- Backfill rows created before server started setting timestamps (e.g. Cashfree deposits).
UPDATE "deposits" SET "created_at" = CURRENT_TIMESTAMP WHERE "created_at" IS NULL;
UPDATE "deposits" SET "updated_at" = COALESCE("updated_at", "created_at", CURRENT_TIMESTAMP) WHERE "updated_at" IS NULL;

ALTER TABLE "deposits" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "deposits" ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE "deposits" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "deposits" ALTER COLUMN "updated_at" SET NOT NULL;

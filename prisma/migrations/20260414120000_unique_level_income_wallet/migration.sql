-- Ensure MLM level income credits are idempotent at DB level.
-- This prevents duplicates even under concurrency and avoids NULL-uniqueness edge cases
-- by scoping the unique index to level_income rows with non-null keys.

CREATE UNIQUE INDEX IF NOT EXISTS "wallet_level_income_unique"
ON "wallet" ("regNo", "source_id", "level")
WHERE "comment" = 'level_income'
  AND "regNo" IS NOT NULL
  AND "source_id" IS NOT NULL
  AND "level" IS NOT NULL;


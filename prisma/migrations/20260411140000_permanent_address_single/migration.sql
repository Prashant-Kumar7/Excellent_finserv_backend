-- Replace split permanent_* columns with one `permanent_address` text field.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'permanent_address'
  ) THEN
    ALTER TABLE "users" ADD COLUMN "permanent_address" TEXT;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'permanent_house_no'
  ) THEN
    UPDATE "users" SET "permanent_address" = NULLIF(
      trim(both FROM concat_ws(
        E'\n',
        nullif(trim(both FROM coalesce("permanent_house_no", '')), ''),
        nullif(trim(both FROM coalesce("permanent_village", '')), ''),
        nullif(trim(both FROM coalesce("permanent_district", '')), ''),
        nullif(trim(both FROM coalesce("permanent_city", '')), ''),
        nullif(trim(both FROM (
          CASE
            WHEN trim(both FROM coalesce("permanent_state", '')) <> ''
              AND trim(both FROM coalesce("permanent_pincode", '')) <> ''
              THEN trim(both FROM "permanent_state") || ' ' || trim(both FROM "permanent_pincode")
            WHEN trim(both FROM coalesce("permanent_state", '')) <> '' THEN trim(both FROM "permanent_state")
            WHEN trim(both FROM coalesce("permanent_pincode", '')) <> '' THEN trim(both FROM "permanent_pincode")
            ELSE NULL
          END
        )), '')
      )),
      ''
    )
    WHERE coalesce(trim(both FROM coalesce("permanent_address", '')), '') = '';

    ALTER TABLE "users" DROP COLUMN IF EXISTS "permanent_house_no";
    ALTER TABLE "users" DROP COLUMN IF EXISTS "permanent_village";
    ALTER TABLE "users" DROP COLUMN IF EXISTS "permanent_city";
    ALTER TABLE "users" DROP COLUMN IF EXISTS "permanent_district";
    ALTER TABLE "users" DROP COLUMN IF EXISTS "permanent_state";
    ALTER TABLE "users" DROP COLUMN IF EXISTS "permanent_pincode";
  END IF;
END $$;

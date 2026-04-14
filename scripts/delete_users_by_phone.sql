-- Deletes all records related to specific mobile numbers across the database.
-- Target DB: PostgreSQL (Prisma datasource provider = postgresql)
--
-- Usage:
--   psql "$DATABASE_URL" -f backend/scripts/delete_users_by_phone.sql
--
-- IMPORTANT:
-- 1) Take a DB backup before running this.
-- 2) Validate in staging first.

BEGIN;

DO $$
DECLARE
  rec RECORD;
BEGIN
  -- Target users by mobile number.
  CREATE TEMP TABLE __target_users AS
  SELECT id, "regNo" AS "regNo", mobile
  FROM users
  WHERE mobile IN ('8169645431', '9969302893');

  RAISE NOTICE 'Matched users: %', (SELECT COUNT(*) FROM __target_users);

  -- Delete rows linked by user-id style columns.
  FOR rec IN
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name <> 'users'
      AND column_name IN (
        'user_id',
        'buyer_id',
        'seller_id',
        'source_id',
        'referrerUserId',
        'referredUserId',
        'userId'
      )
  LOOP
    EXECUTE format(
      'DELETE FROM %I.%I WHERE %I IN (SELECT id FROM __target_users);',
      rec.table_schema, rec.table_name, rec.column_name
    );
    RAISE NOTICE 'Deleted by id from %.% using %', rec.table_schema, rec.table_name, rec.column_name;
  END LOOP;

  -- Delete rows linked by registration number.
  FOR rec IN
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name <> 'users'
      AND column_name IN ('regNo', 'reg_no')
  LOOP
    EXECUTE format(
      'DELETE FROM %I.%I WHERE %I IN (SELECT "regNo" FROM __target_users WHERE "regNo" IS NOT NULL);',
      rec.table_schema, rec.table_name, rec.column_name
    );
    RAISE NOTICE 'Deleted by regNo from %.% using %', rec.table_schema, rec.table_name, rec.column_name;
  END LOOP;

  -- Delete rows linked by mobile number.
  FOR rec IN
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name <> 'users'
      AND column_name = 'mobile'
  LOOP
    EXECUTE format(
      'DELETE FROM %I.%I WHERE %I IN (SELECT mobile FROM __target_users WHERE mobile IS NOT NULL);',
      rec.table_schema, rec.table_name, rec.column_name
    );
    RAISE NOTICE 'Deleted by mobile from %.% using %', rec.table_schema, rec.table_name, rec.column_name;
  END LOOP;

  -- Finally delete from users.
  DELETE FROM users
  WHERE id IN (SELECT id FROM __target_users);

  RAISE NOTICE 'Deleted users rows: %', (SELECT COUNT(*) FROM __target_users);
END $$;

COMMIT;

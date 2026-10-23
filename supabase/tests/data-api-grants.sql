-- Read-only catalog assertions after a complete migration replay.
-- Run as the migration owner on an isolated test/preview database.
-- This does not issue GRANT, change RLS or change production data.
BEGIN;

DO $$
DECLARE
  item record;
  role_name text;
  operation text;
BEGIN
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r') <> 59 THEN
    RAISE EXCEPTION 'Expected 59 public tables after the reviewed TOKOLINK migrations';
  END IF;

  FOR item IN
    SELECT c.oid, c.relname, c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    IF NOT item.relrowsecurity THEN
      RAISE EXCEPTION 'RLS is disabled on public.%', item.relname;
    END IF;
    -- Every table is explicitly reachable by the trusted backend. The source
    -- inventory verifies these are same-migration grants, not default grants.
    FOREACH operation IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF NOT has_table_privilege('service_role', item.oid, operation) THEN
        RAISE EXCEPTION 'service_role missing % on public.%', operation, item.relname;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_column_privilege(role_name, 'public.customers', 'pin', 'SELECT')
       OR has_column_privilege(role_name, 'public.business_members', 'staff_pin', 'SELECT')
       OR has_column_privilege(role_name, 'public.preparation_jobs', 'delivered_pin', 'SELECT') THEN
      RAISE EXCEPTION 'Secret PIN SELECT unexpectedly granted to %', role_name;
    END IF;
    FOR item IN
      SELECT unnest(ARRAY['profiles', 'devices', 'background_action_log',
        'device_action_rate', 'notification_actions', 'pin_search_log']) AS relname
    LOOP
      FOREACH operation IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
        IF has_table_privilege(role_name, 'public.' || item.relname, operation) THEN
          RAISE EXCEPTION '% unexpectedly has direct % on public.%', role_name, operation, item.relname;
        END IF;
      END LOOP;
      IF has_any_column_privilege(role_name, 'public.' || item.relname, 'SELECT') THEN
        RAISE EXCEPTION '% unexpectedly has column SELECT on public.%', role_name, item.relname;
      END IF;
    END LOOP;
    IF has_sequence_privilege(role_name, 'public.pin_search_log_id_seq', 'USAGE')
       OR has_sequence_privilege(role_name, 'public.pin_search_log_id_seq', 'SELECT')
       OR has_sequence_privilege(role_name, 'public.pin_search_log_id_seq', 'UPDATE') THEN
      RAISE EXCEPTION 'PIN search sequence unexpectedly accessible to %', role_name;
    END IF;
  END LOOP;

  IF has_table_privilege('authenticated', 'public.customers', 'SELECT')
     OR has_table_privilege('authenticated', 'public.business_members', 'SELECT')
     OR has_table_privilege('authenticated', 'public.preparation_jobs', 'SELECT') THEN
    RAISE EXCEPTION 'A table-level SELECT bypasses a reviewed PIN column restriction';
  END IF;

  -- status_feed() is SECURITY INVOKER. Its dependency status_mutes needs SELECT
  -- even though the browser only writes that table directly.
  FOR item IN
    SELECT unnest(ARRAY['statuses', 'status_items', 'status_views', 'status_mutes']) AS relname
  LOOP
    IF NOT has_table_privilege('authenticated', 'public.' || item.relname, 'SELECT') THEN
      RAISE EXCEPTION 'status_feed dependency SELECT missing: %', item.relname;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='status_feed' AND p.prosecdef) THEN
    RAISE EXCEPTION 'status_feed unexpectedly bypasses caller RLS';
  END IF;

  -- No anonymous policies exist on the reviewed public tables. Column grants
  -- retained by preparation_jobs do not grant rows without an RLS policy.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
             AND permissive='PERMISSIVE' AND (roles @> ARRAY['anon']::name[] OR roles @> ARRAY['public']::name[])) THEN
    RAISE EXCEPTION 'Unexpected permissive anonymous/public policy';
  END IF;
END $$;

ROLLBACK;

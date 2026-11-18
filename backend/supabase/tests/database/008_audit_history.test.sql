-- Group: database. Append-only audit history: a change made through the Data API by a signed-in dictator is recorded
-- with that actor, the action, the table, the record and a safe summary (only changed fields for an update; private
-- contact fields never written). Nobody can change or remove history, the server key included, and only dictators
-- read it. Rolled back.
BEGIN;
SELECT plan(26);

INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
SELECT ('a8000000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated',
       (ARRAY['au.dictator','au.captain','au.normal','au.admin'])[n] || '@iiitkottayam.ac.in', '', now(), now()
FROM generate_series(1, 4) AS n;
UPDATE public.user_roles SET role = 'dictator' WHERE user_id = 'a8000000-0000-4000-8000-000000000001';
UPDATE public.user_roles SET role = 'captain'  WHERE user_id = 'a8000000-0000-4000-8000-000000000002';
UPDATE public.user_roles SET role = 'admin'    WHERE user_id = 'a8000000-0000-4000-8000-000000000004';

CREATE FUNCTION pg_temp.as_user(p_n integer, p_sql text, p_role text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v integer;
  v_uid uuid := CASE WHEN p_n IS NULL THEN NULL ELSE ('a8000000-0000-4000-8000-00000000000' || p_n)::uuid END;
  v_role text := COALESCE(p_role, CASE WHEN p_n IS NULL THEN 'anon' ELSE 'authenticated' END);
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN v_uid IS NULL THEN json_build_object('role', v_role)::text ELSE json_build_object('sub', v_uid, 'role', v_role)::text END, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_uid::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', v_role);
  IF p_sql ~* '^\s*select' THEN
    EXECUTE p_sql INTO v;
  ELSE
    EXECUTE p_sql;
    GET DIAGNOSTICS v = ROW_COUNT;
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END;
$$;

CREATE TEMP TABLE _mark AS SELECT COALESCE(max(id), 0) AS id FROM public.audit_log;
GRANT SELECT ON _mark TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.last(p_table text) RETURNS public.audit_log LANGUAGE sql AS $$
  SELECT * FROM public.audit_log WHERE table_name = p_table AND id > (SELECT id FROM _mark) ORDER BY id DESC LIMIT 1
$$;

-- Schema and access ------------------------------------------------------------------------------------------
SELECT has_table('public', 'audit_log', 'the audit history exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.audit_log'::regclass), 'it has row level security');
SELECT ok(NOT has_table_privilege('anon', 'public.audit_log', 'SELECT'), 'anon cannot read it at all');
SELECT ok(NOT has_table_privilege('authenticated', 'public.audit_log', 'INSERT,UPDATE,DELETE'), 'signed-in users have no write privilege');
SELECT ok(NOT has_table_privilege('service_role', 'public.audit_log', 'INSERT,UPDATE,DELETE'), 'the server key has no write privilege');
SELECT ok((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.audit_row_change()'::regprocedure), 'the recorder runs with the owner''s rights');
SELECT ok(NOT has_function_privilege('authenticated', 'public.audit_row_change()', 'EXECUTE'), 'the recorder cannot be called directly');

-- A dictator's configuration change through the Data API ------------------------------------------------------
SELECT is(pg_temp.as_user(1, $q$INSERT INTO public.divisions (slug, name) VALUES ('audit-check', 'Audit Check')$q$), 1, 'a dictator creates a division');
SELECT results_eq(
  $$SELECT actor_id, actor_role, action, changes ->> 'slug', changes ->> 'name' FROM pg_temp.last('divisions')$$,
  $$VALUES ('a8000000-0000-4000-8000-000000000001'::uuid, 'authenticated'::text, 'insert'::text, 'audit-check'::text, 'Audit Check'::text)$$,
  'the creation is recorded with the dictator as actor and the new values');
SELECT is((SELECT record_id FROM pg_temp.last('divisions')), (SELECT id::text FROM public.divisions WHERE slug = 'audit-check'), 'the record is identified');
SELECT is(pg_temp.as_user(1, $q$UPDATE public.divisions SET name = 'Audit Renamed', visibility = 'hidden' WHERE slug = 'audit-check'$q$), 1, 'a dictator edits it');
SELECT is((SELECT changes FROM pg_temp.last('divisions')),
  '{"name": {"from": "Audit Check", "to": "Audit Renamed"}, "visibility": {"from": "public", "to": "hidden"}}'::jsonb,
  'an update records only the changed fields, from and to');
SELECT is(pg_temp.as_user(1, $q$UPDATE public.divisions SET name = 'Audit Renamed' WHERE slug = 'audit-check'$q$), 1, 'an update that changes nothing');
SELECT is((SELECT action FROM pg_temp.last('divisions')), 'update', 'adds no second history row');
SELECT is((SELECT count(*) FROM public.audit_log WHERE table_name = 'divisions' AND id > (SELECT id FROM _mark))::int, 2, 'still two rows for the division');
SELECT is(pg_temp.as_user(1, $q$DELETE FROM public.divisions WHERE slug = 'audit-check'$q$), 1, 'a dictator deletes it');
SELECT is((SELECT action || ':' || (changes ->> 'name') FROM pg_temp.last('divisions')), 'delete:Audit Renamed', 'the deletion is recorded with what was removed');

-- Composite keys, private fields and server work ----------------------------------------------------------------
UPDATE public.season_sections SET enabled = NOT enabled WHERE section_key = 'fantasy' AND season_id = (SELECT id FROM public.seasons WHERE is_current ORDER BY id LIMIT 1);
SELECT is((SELECT record_id FROM pg_temp.last('season_sections')),
  (SELECT id::text FROM public.seasons WHERE is_current ORDER BY id LIMIT 1) || ':fantasy', 'a section is identified by season and key');
SELECT is((SELECT actor_role FROM pg_temp.last('season_sections')), 'postgres', 'server and migration work is recorded under its database session');
UPDATE public.player_private_details SET email = 'changed.address@iiitkottayam.ac.in' WHERE player_id = (SELECT player_id FROM public.player_private_details LIMIT 1);
SELECT is((SELECT changes FROM pg_temp.last('player_private_details')), '{"email": {"changed": true}}'::jsonb, 'a private email change is recorded without the address');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.audit_log WHERE changes::text LIKE '%@%'), 'no email address appears anywhere in the history');
UPDATE public.matches SET minute = '17', timer_calibration = 3 WHERE id = (SELECT id FROM public.matches ORDER BY id LIMIT 1);
SELECT is((SELECT count(*) FROM public.audit_log WHERE table_name = 'matches' AND id > (SELECT id FROM _mark))::int, 0, 'the running match clock is not recorded');

-- Nobody changes history; only dictators read it ------------------------------------------------------------------
SELECT throws_ok($$SELECT pg_temp.as_user(1, 'DELETE FROM public.audit_log')$$, '42501', NULL, 'a dictator cannot delete history');
SELECT throws_ok($$SELECT pg_temp.as_user(NULL, $q$UPDATE public.audit_log SET actor_role = 'x'$q$, 'service_role')$$, '42501', NULL, 'the server key cannot rewrite history');
SELECT throws_ok($$UPDATE public.audit_log SET actor_role = 'x' WHERE id = (SELECT max(id) FROM public.audit_log)$$, '42501', 'Audit history cannot be changed or removed',
  'even the database owner is refused by the append-only trigger');
SELECT is(
  ARRAY[pg_temp.as_user(2, 'SELECT count(*) FROM public.audit_log'), pg_temp.as_user(3, 'SELECT count(*) FROM public.audit_log'), pg_temp.as_user(4, 'SELECT count(*) FROM public.audit_log')]::int[],
  ARRAY[0, 0, 0], 'a captain, a normal user and a legacy admin read nothing; dictators do (checked above through pg_temp.last as owner)');

SELECT * FROM finish();
ROLLBACK;

-- Group: database. The legacy stored role 'admin' grants nothing: an account still holding it cannot change roles
-- (its own included), cannot read other people's roles, registrations or predictions, and nobody can assign 'admin'
-- any more. Its rows are not changed here: mapping each legacy admin is a reviewed per-person step. A dictator keeps
-- managing roles. Rolled back.
BEGIN;
SELECT plan(9);

INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
SELECT ('ab000000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated',
       (ARRAY['la.admin','la.dictator','la.member'])[n] || '@iiitkottayam.ac.in', '', now(), now()
FROM generate_series(1, 3) AS n;
UPDATE public.user_roles SET role = 'admin'    WHERE user_id = 'ab000000-0000-4000-8000-000000000001';
UPDATE public.user_roles SET role = 'dictator' WHERE user_id = 'ab000000-0000-4000-8000-000000000002';

CREATE FUNCTION pg_temp.as_user(p_n integer, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
  v_uid uuid := ('ab000000-0000-4000-8000-00000000000' || p_n)::uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  SET LOCAL ROLE authenticated;
  EXECUTE p_sql INTO v;
  RESET ROLE;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RAISE;
END;
$$;

-- A legacy admin cannot promote itself: the update matches no row it may change.
SELECT pg_temp.as_user(1, $q$WITH u AS (UPDATE public.user_roles SET role = 'dictator' WHERE user_id = 'ab000000-0000-4000-8000-000000000001' RETURNING 1) SELECT count(*)::text FROM u$q$);
SELECT is((SELECT role FROM public.user_roles WHERE user_id = 'ab000000-0000-4000-8000-000000000001'), 'admin', 'a legacy admin cannot promote itself to dictator');
SELECT throws_ok($$SELECT pg_temp.as_user(1, $q$INSERT INTO public.user_roles (user_id, role) VALUES ('ab000000-0000-4000-8000-000000000003', 'dictator') ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role RETURNING role$q$)$$,
  '42501', NULL, 'a legacy admin cannot give anyone a role');
SELECT is((SELECT role FROM public.user_roles WHERE user_id = 'ab000000-0000-4000-8000-000000000003'), 'default', 'and nothing was written');
SELECT is(pg_temp.as_user(1, $q$SELECT count(*)::text FROM public.user_roles$q$), '1', 'a legacy admin reads only its own role');
SELECT is(pg_temp.as_user(1, $q$SELECT count(*)::text FROM public.team_registrations$q$), '0', 'a legacy admin reads no team registrations');
SELECT is(pg_temp.as_user(1, $q$SELECT count(*)::text FROM public.predictions WHERE user_id <> 'ab000000-0000-4000-8000-000000000001'$q$), '0', 'a legacy admin reads nobody else''s predictions');

-- Nobody assigns the legacy role any more; a dictator still manages roles.
SELECT throws_ok($$SELECT pg_temp.as_user(2, $q$INSERT INTO public.user_roles (user_id, role) VALUES ('ab000000-0000-4000-8000-000000000003', 'admin') ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role RETURNING role$q$)$$,
  '42501', NULL, 'a dictator cannot assign the legacy admin role');
SELECT is(pg_temp.as_user(2, $q$INSERT INTO public.user_roles (user_id, role) VALUES ('ab000000-0000-4000-8000-000000000003', 'captain') ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role RETURNING role$q$),
  'captain', 'a dictator still assigns roles');

-- No policy or role-check function names the legacy role as granting access.
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND (coalesce(qual, '') ~ '''admin''' OR coalesce(with_check, '') ~ '''admin'''))
          + (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname IN ('is_role_manager', 'is_dictator') AND pg_get_functiondef(p.oid) ~ '''admin'''),
  0, 'no policy or role check grants anything to the legacy admin role');

SELECT * FROM finish();
ROLLBACK;

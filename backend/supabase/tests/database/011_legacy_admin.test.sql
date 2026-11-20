-- Group: database. The legacy stored role 'admin' is retired (owner decision 2026-11-19): the value can no longer be
-- stored or assigned, no account holds it (former holders are ordinary users, never promoted), its unused helper is
-- gone, and no policy or role check mentions it. A normal user cannot promote itself or read other people's roles,
-- registrations or predictions; a dictator still manages roles. Rolled back.
BEGIN;
SELECT plan(11);

INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
SELECT ('ab000000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated',
       (ARRAY['la.user','la.dictator','la.member'])[n] || '@iiitkottayam.ac.in', '', now(), now()
FROM generate_series(1, 3) AS n;
INSERT INTO public.user_roles (user_id, role) VALUES ('ab000000-0000-4000-8000-000000000002', 'dictator');

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
-- True when the statement is refused (any error), so each case reports a plain pass or fail.
CREATE FUNCTION pg_temp.refused(p_n integer, p_sql text)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(p_n, p_sql);
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN true;
END;
$$;

-- The value is gone.
SELECT throws_ok($$INSERT INTO public.user_roles (user_id, role) VALUES ('ab000000-0000-4000-8000-000000000003', 'admin')$$,
  '23514', NULL, 'the legacy admin role can no longer be stored');
SELECT is((SELECT count(*)::int FROM public.user_roles WHERE role NOT IN ('captain', 'scorer', 'editor', 'dictator')), 0,
  'every stored role is one of the agreed roles');
SELECT hasnt_function('public', 'get_user_role', 'the unused legacy role helper is gone');
SELECT ok(pg_temp.refused(2, $q$INSERT INTO public.user_roles (user_id, role) VALUES ('ab000000-0000-4000-8000-000000000003', 'admin') ON CONFLICT DO NOTHING RETURNING role$q$),
  'a dictator cannot assign the legacy admin role');

-- An ordinary user (as every former legacy admin now is) gets nothing.
SELECT ok(pg_temp.refused(1, $q$INSERT INTO public.user_roles (user_id, role) VALUES ('ab000000-0000-4000-8000-000000000001', 'dictator')$q$), 'an ordinary user cannot promote itself');
SELECT is((SELECT count(*)::int FROM public.user_roles WHERE user_id = 'ab000000-0000-4000-8000-000000000001'), 0, 'and still holds no grant');
SELECT ok(pg_temp.refused(1, $q$INSERT INTO public.user_roles (user_id, role) VALUES ('ab000000-0000-4000-8000-000000000003', 'dictator') ON CONFLICT DO NOTHING RETURNING role$q$),
  'an ordinary user cannot give anyone a role');
SELECT is(pg_temp.as_user(1, $q$SELECT count(*)::text FROM public.user_roles$q$), '0', 'an ordinary user reads no one else''s roles');
SELECT is(pg_temp.as_user(1, $q$SELECT count(*)::text FROM public.predictions WHERE user_id <> 'ab000000-0000-4000-8000-000000000001'$q$), '0', 'an ordinary user reads nobody else''s predictions');

-- A dictator still manages roles, and nothing names the legacy role as granting access.
SELECT is(pg_temp.as_user(2, $q$INSERT INTO public.user_roles (user_id, role) VALUES ('ab000000-0000-4000-8000-000000000003', 'captain') ON CONFLICT DO NOTHING RETURNING role$q$),
  'captain', 'a dictator still assigns roles');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND (coalesce(qual, '') ~ '''admin''' OR coalesce(with_check, '') ~ '''admin'''))
          + (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname IN ('is_role_manager', 'is_dictator') AND pg_get_functiondef(p.oid) ~ '''admin'''),
  0, 'no policy or role check mentions the legacy admin role');

SELECT * FROM finish();
ROLLBACK;

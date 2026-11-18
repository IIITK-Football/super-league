-- Group: database. public.set_current_season switches a division's current season in one step, for dictators only.
BEGIN;
SELECT plan(12);

CREATE FUNCTION pg_temp.call_as(p_role text, p_uid uuid, p_season uuid)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN '{}' ELSE json_build_object('sub', p_uid, 'role', p_role)::text END, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  PERFORM public.set_current_season(p_season);
  RESET ROLE;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN SQLSTATE;
END;
$$;

INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
SELECT ('c5000000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated',
       (ARRAY['cur.dictator', 'cur.captain', 'cur.admin', 'cur.normal'])[n] || '@iiitkottayam.ac.in', '', now(), now()
FROM generate_series(1, 4) AS n;
UPDATE public.user_roles SET role = 'dictator' WHERE user_id = 'c5000000-0000-4000-8000-000000000001';
UPDATE public.user_roles SET role = 'captain'  WHERE user_id = 'c5000000-0000-4000-8000-000000000002';
UPDATE public.user_roles SET role = 'default'    WHERE user_id = 'c5000000-0000-4000-8000-000000000003';

INSERT INTO public.seasons (id, division_id, slug, name, status) VALUES
  ('f5000000-0000-4000-8000-000000000001', (SELECT id FROM public.divisions WHERE slug = 'super-league'), '2027', '2027', 'planned'),
  ('f5000000-0000-4000-8000-000000000002', (SELECT id FROM public.divisions WHERE slug = 'super-league'), '2028', '2028', 'planned');
UPDATE public.seasons SET archived_at = now() WHERE id = 'f5000000-0000-4000-8000-000000000002';

CREATE TEMP TABLE old_current AS
SELECT s.id FROM public.seasons s JOIN public.divisions d ON d.id = s.division_id WHERE d.slug = 'super-league' AND s.is_current;
GRANT SELECT ON old_current TO authenticated;

SELECT ok(NOT has_function_privilege('anon', 'public.set_current_season(uuid)', 'EXECUTE'), 'anon cannot execute it');
SELECT ok(NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.set_current_season(uuid)'::regprocedure),
  'it runs with the caller''s rights (RLS still applies)');
SELECT is((SELECT c FROM pg_proc p, unnest(p.proconfig) c WHERE p.oid = 'public.set_current_season(uuid)'::regprocedure AND c LIKE 'search_path=%'),
  'search_path=""', 'it pins an empty search_path');

SELECT is(pg_temp.call_as('authenticated', 'c5000000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000001'), '42501', 'a captain is refused');
SELECT is(pg_temp.call_as('authenticated', 'c5000000-0000-4000-8000-000000000003', 'f5000000-0000-4000-8000-000000000001'), '42501', 'a former legacy admin, now an ordinary user, is refused');
SELECT is(pg_temp.call_as('authenticated', 'c5000000-0000-4000-8000-000000000004', 'f5000000-0000-4000-8000-000000000001'), '42501', 'a normal user is refused');
SELECT is(pg_temp.call_as('anon', NULL, 'f5000000-0000-4000-8000-000000000001'), '42501', 'anon is refused');
SELECT ok((SELECT is_current FROM public.seasons WHERE id = (SELECT id FROM old_current)), 'refusals change nothing');

SELECT is(pg_temp.call_as('authenticated', 'c5000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000002'), '22023',
  'an archived season cannot become current');
SELECT is(pg_temp.call_as('authenticated', 'c5000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001'), 'ok',
  'a dictator makes a planned season current');
SELECT ok((SELECT is_current FROM public.seasons WHERE id = 'f5000000-0000-4000-8000-000000000001')
          AND NOT (SELECT is_current FROM public.seasons WHERE id = (SELECT id FROM old_current)),
  'the previous current season is cleared in the same step');

SELECT is((SELECT count(*) FROM public.seasons WHERE is_current)::int, 3,
  'other divisions keep their own current season');

SELECT * FROM finish();
ROLLBACK;

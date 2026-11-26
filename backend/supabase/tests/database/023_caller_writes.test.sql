-- Group: database. Writes a person starts run as that person (D-04), so the audit history names them:
--   * team_details_for_edit / captain_update_team_details: a dictator or the captain of a writable team entry reads
--     and changes the shared team's details; another team's captain, a scorer, a normal user and anon cannot. Both are
--     SECURITY DEFINER with an empty search_path, and anon and PUBLIC cannot execute them.
--   * create_awarded_match: creates a match and awards it in one transaction. A refused award leaves no match behind;
--     only a dictator can call it. SECURITY INVOKER with an empty search_path.
-- Rolled back.
BEGIN;
SELECT plan(25);

-- Structure ---------------------------------------------------------------------------------------------------------
SELECT has_function('public', 'team_details_for_edit', ARRAY['uuid'], 'team details are read through one function');
SELECT has_function('public', 'captain_update_team_details', ARRAY['uuid', 'text', 'text', 'text', 'text'], 'team details are written through one function');
SELECT has_function('public', 'create_awarded_match', ARRAY['uuid', 'uuid', 'uuid', 'timestamp with time zone', 'text', 'text', 'integer', 'integer', 'text'], 'an awarded match is created through one function');
SELECT is_definer('public', 'captain_update_team_details', ARRAY['uuid', 'text', 'text', 'text', 'text'], 'the team details writer checks the caller itself');
SELECT isnt_definer('public', 'create_awarded_match', ARRAY['uuid', 'uuid', 'uuid', 'timestamp with time zone', 'text', 'text', 'integer', 'integer', 'text'], 'the awarded match insert runs under the caller''s RLS');
SELECT ok(
  (SELECT bool_and(p.proconfig @> ARRAY['search_path=""']) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('team_details_for_edit', 'captain_update_team_details', 'create_awarded_match')),
  'all three pin an empty search_path');
SELECT ok(
  NOT has_function_privilege('anon', 'public.captain_update_team_details(uuid, text, text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.team_details_for_edit(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.create_awarded_match(uuid, uuid, uuid, timestamptz, text, text, integer, integer, text)', 'EXECUTE'),
  'anon cannot execute any of them');

-- Fixture: two seeded team entries of the current WSL season, accounts ------------------------------------------------
CREATE TEMP TABLE _w AS
SELECT s.id AS season_id, e1.team_id AS ta, e2.team_id AS tb, e1.id AS ea, e2.id AS eb
FROM public.seasons s JOIN public.divisions d ON d.id = s.division_id AND d.slug = 'wsl'
JOIN LATERAL (SELECT id, team_id FROM public.team_entries WHERE season_id = s.id ORDER BY id LIMIT 1) e1 ON true
JOIN LATERAL (SELECT id, team_id FROM public.team_entries WHERE season_id = s.id ORDER BY id OFFSET 1 LIMIT 1) e2 ON true
WHERE s.is_current;
GRANT SELECT ON _w TO authenticated, anon;
INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
SELECT ('e2300000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated', 'cw.user' || n || '@iiitkottayam.ac.in', '', now(), now()
FROM generate_series(1, 4) AS n;
-- 1 normal, 2 captain of entry A, 3 scorer, 4 dictator
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e2300000-0000-4000-8000-000000000002', 'captain'), ('e2300000-0000-4000-8000-000000000003', 'scorer'),
  ('e2300000-0000-4000-8000-000000000004', 'dictator');
INSERT INTO public.captain_assignments (team_entry_id, user_id) VALUES ((SELECT ea FROM _w), 'e2300000-0000-4000-8000-000000000002');

CREATE FUNCTION pg_temp.as_user(p_n integer, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  IF p_n IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', ('e2300000-0000-4000-8000-00000000000' || p_n)::uuid, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', ('e2300000-0000-4000-8000-00000000000' || p_n), true);
    SET LOCAL ROLE authenticated;
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    SET LOCAL ROLE anon;
  END IF;
  EXECUTE p_sql INTO v;
  RESET ROLE;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RAISE;
END;
$$;

CREATE FUNCTION pg_temp.update_sql(p_entry text, p_color text) RETURNS text LANGUAGE sql AS
$$ SELECT format('SELECT public.captain_update_team_details(%L::uuid, NULL, NULL, %L, NULL)::text', p_entry, p_color) $$;

-- Team details ------------------------------------------------------------------------------------------------------
SELECT is(pg_temp.as_user(2, format('SELECT team_id::text FROM public.team_details_for_edit(%L)', (SELECT ea FROM _w))),
  (SELECT ta FROM _w)::text, 'the captain reads their own team''s details');
SELECT lives_ok(format('SELECT pg_temp.as_user(2, %L)', pg_temp.update_sql((SELECT ea FROM _w)::text, '#112233')),
  'the captain changes their own team''s colour');
SELECT is((SELECT team_color FROM public.teams WHERE id = (SELECT ta FROM _w)), '#112233', 'the colour is stored');
SELECT is((SELECT actor_id FROM public.audit_log WHERE table_name = 'teams' AND record_id = (SELECT ta FROM _w)::text ORDER BY id DESC LIMIT 1),
  'e2300000-0000-4000-8000-000000000002'::uuid, 'the audit history names the captain');
SELECT lives_ok(format('SELECT pg_temp.as_user(4, %L)', pg_temp.update_sql((SELECT eb FROM _w)::text, '#445566')),
  'a dictator changes any team''s details');
SELECT is((SELECT actor_id FROM public.audit_log WHERE table_name = 'teams' AND record_id = (SELECT tb FROM _w)::text ORDER BY id DESC LIMIT 1),
  'e2300000-0000-4000-8000-000000000004'::uuid, 'the audit history names the dictator');
SELECT throws_ok(format('SELECT pg_temp.as_user(2, %L)', pg_temp.update_sql((SELECT eb FROM _w)::text, '#000001')),
  '42501', NULL, 'a captain cannot change another team');
SELECT throws_ok(format('SELECT pg_temp.as_user(3, %L)', pg_temp.update_sql((SELECT ea FROM _w)::text, '#000001')),
  '42501', NULL, 'a scorer cannot change team details');
SELECT throws_ok(format('SELECT pg_temp.as_user(1, %L)', pg_temp.update_sql((SELECT ea FROM _w)::text, '#000001')),
  '42501', NULL, 'a normal user cannot change team details');
SELECT throws_ok(format('SELECT pg_temp.as_user(1, %L)', format('SELECT team_id::text FROM public.team_details_for_edit(%L)', (SELECT ea FROM _w))),
  '42501', NULL, 'a normal user cannot read details through the edit function');
SELECT throws_ok(format('SELECT pg_temp.as_user(NULL, %L)', pg_temp.update_sql((SELECT ea FROM _w)::text, '#000001')),
  '42501', NULL, 'anon cannot change team details');
SELECT throws_ok(format('SELECT pg_temp.as_user(2, %L)', pg_temp.update_sql((SELECT ea FROM _w)::text, 'red')),
  '22023', NULL, 'an invalid colour is refused');
SELECT is((SELECT team_color FROM public.teams WHERE id = (SELECT ta FROM _w)), '#112233', 'refused changes leave the colour unchanged');

-- Awarded match in one transaction --------------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.award_sql(p_home integer) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT id::text FROM public.create_awarded_match(%L, %L, %L, now() + interval ''3 days'', NULL, ''walkover'', %s, 0, ''no show'')',
    (SELECT season_id FROM _w), (SELECT ta FROM _w), (SELECT tb FROM _w), p_home)
$$;
CREATE TEMP TABLE _count AS SELECT count(*) AS n FROM public.matches WHERE season_id = (SELECT season_id FROM _w);

SELECT throws_ok(format('SELECT pg_temp.as_user(4, %L)', pg_temp.award_sql(-1)),
  '22023', NULL, 'a refused award raises');
SELECT is((SELECT count(*) FROM public.matches WHERE season_id = (SELECT season_id FROM _w)), (SELECT n FROM _count),
  'and leaves no match behind');
SELECT throws_ok(format('SELECT pg_temp.as_user(3, %L)', pg_temp.award_sql(3)),
  '42501', NULL, 'a scorer cannot create an awarded match');
SELECT isnt(pg_temp.as_user(4, pg_temp.award_sql(3)), NULL, 'a dictator creates and awards a match in one call');
SELECT is((SELECT count(*) FROM public.matches WHERE season_id = (SELECT season_id FROM _w) AND result_kind = 'walkover' AND home_score = 3 AND status = 'completed'
           AND id IN (SELECT record_id::uuid FROM public.audit_log WHERE table_name = 'matches' AND actor_id = 'e2300000-0000-4000-8000-000000000004')),
  1::bigint, 'the match is completed as a walkover, recorded with the dictator as actor');

SELECT * FROM finish();
ROLLBACK;

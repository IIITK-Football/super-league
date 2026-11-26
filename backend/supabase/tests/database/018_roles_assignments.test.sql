-- Group: database (auth-roles). Roles are independent grants (captain, scorer, editor, dictator; a normal user has none)
-- and captain and scorer powers need a scoped assignment on top. A captain assignment is writable while its season is
-- current or upcoming and not completed or archived (D-03 addendum); a scorer is scoped to a season or one match with
-- an optional expiry. Direct writes to matches, goals, teams, news, grants and assignments are limited to the roles
-- that own them. Rolled back.
BEGIN;
SELECT plan(51);

-- Structure ---------------------------------------------------------------------------------------------------------
SELECT has_table('public', 'captain_assignments', 'captain assignments exist');
SELECT has_table('public', 'scorer_assignments', 'scorer assignments exist');
SELECT col_is_pk('public', 'user_roles', ARRAY['user_id', 'role'], 'a person holds any number of grants: the key is (user, role)');
SELECT throws_ok($$INSERT INTO public.user_roles (user_id, role) SELECT id, 'admin' FROM auth.users LIMIT 1$$, '23514', NULL, 'the legacy admin value cannot be stored');
SELECT throws_ok($$INSERT INTO public.user_roles (user_id, role) SELECT id, 'default' FROM auth.users LIMIT 1$$, '23514', NULL, 'there is no stored default role: a normal user has no grant');
SELECT is((SELECT count(*)::int FROM public.user_roles WHERE role NOT IN ('captain', 'scorer', 'editor', 'dictator')), 0, 'only the four grants are stored');
SELECT hasnt_function('public', 'is_role_manager', 'the dictator-only role manager helper is replaced');

-- Fixtures: two divisions, a current and a completed and a planned season, teams, entries, matches, accounts ----------
INSERT INTO public.divisions (id, slug, name, visibility) VALUES ('d0100000-0000-4000-8000-000000000001', 'ra-a', 'Roles A', 'public');
INSERT INTO public.seasons (id, division_id, slug, name, status, is_current, visibility) VALUES
  ('d0500000-0000-4000-8000-000000000001', 'd0100000-0000-4000-8000-000000000001', 'cur', 'Current', 'active', true, 'public'),
  ('d0500000-0000-4000-8000-000000000002', 'd0100000-0000-4000-8000-000000000001', 'old', 'Old', 'completed', false, 'public'),
  ('d0500000-0000-4000-8000-000000000003', 'd0100000-0000-4000-8000-000000000001', 'nxt', 'Next', 'planned', false, 'public');
INSERT INTO public.teams (id, name) VALUES
  ('d0700000-0000-4000-8000-000000000001', 'Roles Reds'), ('d0700000-0000-4000-8000-000000000002', 'Roles Blues');
INSERT INTO public.team_entries (id, team_id, season_id) VALUES
  ('d0e00000-0000-4000-8000-000000000001', 'd0700000-0000-4000-8000-000000000001', 'd0500000-0000-4000-8000-000000000001'),
  ('d0e00000-0000-4000-8000-000000000002', 'd0700000-0000-4000-8000-000000000002', 'd0500000-0000-4000-8000-000000000001'),
  ('d0e00000-0000-4000-8000-000000000003', 'd0700000-0000-4000-8000-000000000001', 'd0500000-0000-4000-8000-000000000002'),
  ('d0e00000-0000-4000-8000-000000000004', 'd0700000-0000-4000-8000-000000000001', 'd0500000-0000-4000-8000-000000000003');
INSERT INTO public.matches (id, home_team_id, away_team_id, season_id, status, date) VALUES
  ('d0300000-0000-4000-8000-000000000001', 'd0700000-0000-4000-8000-000000000001', 'd0700000-0000-4000-8000-000000000002', 'd0500000-0000-4000-8000-000000000001', 'scheduled', now()),
  ('d0300000-0000-4000-8000-000000000002', 'd0700000-0000-4000-8000-000000000002', 'd0700000-0000-4000-8000-000000000001', 'd0500000-0000-4000-8000-000000000001', 'scheduled', now());
-- 1 normal, 2 captain, 3 match scorer, 4 season scorer, 5 editor, 6 dictator, 7 second dictator, 8 expired scorer, 9 target
INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
SELECT ('d0b00000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated', 'ra.user' || n || '@iiitkottayam.ac.in', '', now(), now()
FROM generate_series(1, 9) AS n;
SELECT is((SELECT count(*)::int FROM public.user_roles WHERE user_id::text LIKE 'd0b00000%'), 0, 'a new account has no role row');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('d0b00000-0000-4000-8000-000000000002', 'captain'), ('d0b00000-0000-4000-8000-000000000003', 'scorer'),
  ('d0b00000-0000-4000-8000-000000000004', 'scorer'), ('d0b00000-0000-4000-8000-000000000005', 'editor'),
  ('d0b00000-0000-4000-8000-000000000006', 'dictator'), ('d0b00000-0000-4000-8000-000000000007', 'dictator'),
  ('d0b00000-0000-4000-8000-000000000008', 'scorer');
INSERT INTO public.captain_assignments (team_entry_id, user_id) VALUES ('d0e00000-0000-4000-8000-000000000001', 'd0b00000-0000-4000-8000-000000000002');
INSERT INTO public.scorer_assignments (user_id, match_id) VALUES ('d0b00000-0000-4000-8000-000000000003', 'd0300000-0000-4000-8000-000000000001');
INSERT INTO public.scorer_assignments (user_id, season_id) VALUES ('d0b00000-0000-4000-8000-000000000004', 'd0500000-0000-4000-8000-000000000001');
INSERT INTO public.scorer_assignments (user_id, match_id, expires_at) VALUES ('d0b00000-0000-4000-8000-000000000008', 'd0300000-0000-4000-8000-000000000001', now() - interval '1 hour');

CREATE FUNCTION pg_temp.as_user(p_n integer, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ('d0b00000-0000-4000-8000-00000000000' || p_n)::uuid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', ('d0b00000-0000-4000-8000-00000000000' || p_n), true);
  SET LOCAL ROLE authenticated;
  EXECUTE p_sql INTO v;
  RESET ROLE;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RAISE;
END;
$$;
-- The number of rows a statement changed as the given user.
CREATE FUNCTION pg_temp.rows_as(p_n integer, p_sql text)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v integer;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ('d0b00000-0000-4000-8000-00000000000' || p_n)::uuid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', ('d0b00000-0000-4000-8000-00000000000' || p_n), true);
  SET LOCAL ROLE authenticated;
  EXECUTE p_sql;
  GET DIAGNOSTICS v = ROW_COUNT;
  RESET ROLE;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RAISE;
END;
$$;

-- Helpers -----------------------------------------------------------------------------------------------------------
SELECT is(pg_temp.as_user(2, $$SELECT public.my_roles()::text$$), '{captain}', 'my_roles lists the caller''s grants');
SELECT is(pg_temp.as_user(1, $$SELECT public.my_roles()::text$$), '{}', 'a normal user has no grants');
SELECT is(pg_temp.as_user(2, $$SELECT public.is_captain_of('d0e00000-0000-4000-8000-000000000001')::text$$), 'true', 'a captain is captain of the assigned entry');
SELECT is(pg_temp.as_user(2, $$SELECT public.is_captain_of('d0e00000-0000-4000-8000-000000000002')::text$$), 'false', 'but not of another entry');
SELECT is(pg_temp.as_user(3, $$SELECT public.can_score('d0300000-0000-4000-8000-000000000001')::text$$), 'true', 'a match scorer can score the assigned match');
SELECT is(pg_temp.as_user(3, $$SELECT public.can_score('d0300000-0000-4000-8000-000000000002')::text$$), 'false', 'and no other match');
SELECT is(pg_temp.as_user(4, $$SELECT public.can_score('d0300000-0000-4000-8000-000000000002')::text$$), 'true', 'a season scorer can score every match of the season');
SELECT is(pg_temp.as_user(8, $$SELECT public.can_score('d0300000-0000-4000-8000-000000000001')::text$$), 'false', 'an expired scorer assignment scores nothing');
SELECT is(pg_temp.as_user(2, $$SELECT public.can_score('d0300000-0000-4000-8000-000000000001')::text$$), 'false', 'captain status never implies scoring');
SELECT is(pg_temp.as_user(6, $$SELECT public.can_score('d0300000-0000-4000-8000-000000000002')::text$$), 'true', 'a dictator can score any match');

-- Matches, goals, teams, news ---------------------------------------------------------------------------------------
SELECT is(pg_temp.rows_as(1, $$UPDATE public.matches SET minute = '9' WHERE id = 'd0300000-0000-4000-8000-000000000001'$$), 0, 'a normal account cannot write a match');
SELECT is(pg_temp.rows_as(2, $$UPDATE public.matches SET minute = '9' WHERE id = 'd0300000-0000-4000-8000-000000000001'$$), 0, 'a captain cannot write a match');
SELECT is(pg_temp.rows_as(3, $$UPDATE public.matches SET minute = '1' WHERE id = 'd0300000-0000-4000-8000-000000000001'$$), 1, 'the assigned scorer updates the assigned match');
SELECT is(pg_temp.rows_as(3, $$UPDATE public.matches SET minute = '1' WHERE id = 'd0300000-0000-4000-8000-000000000002'$$), 0, 'but not another match');
SELECT is(pg_temp.rows_as(8, $$UPDATE public.matches SET minute = '5' WHERE id = 'd0300000-0000-4000-8000-000000000001'$$), 0, 'an expired scorer updates nothing');
SELECT throws_ok($$SELECT pg_temp.rows_as(3, $q$UPDATE public.matches SET home_team_id = away_team_id WHERE id = 'd0300000-0000-4000-8000-000000000001'$q$)$$, '42501', NULL, 'a scorer cannot change which teams play');
SELECT throws_ok($$SELECT pg_temp.rows_as(3, $q$INSERT INTO public.matches (home_team_id, away_team_id, season_id) VALUES ('d0700000-0000-4000-8000-000000000001', 'd0700000-0000-4000-8000-000000000002', 'd0500000-0000-4000-8000-000000000001')$q$)$$, '42501', NULL, 'a scorer cannot create fixtures');
SELECT is(pg_temp.rows_as(6, $$DELETE FROM public.matches WHERE id = 'd0300000-0000-4000-8000-000000000002'$$), 1, 'a dictator deletes a match');
SELECT is(pg_temp.rows_as(1, $$UPDATE public.teams SET name = 'Hacked' WHERE id = 'd0700000-0000-4000-8000-000000000001'$$), 0, 'a normal account cannot rename a team');
SELECT is(pg_temp.rows_as(2, $$UPDATE public.teams SET name = 'Hacked' WHERE id = 'd0700000-0000-4000-8000-000000000001'$$), 0, 'a captain cannot rename a team directly (the route validates it)');
SELECT is(pg_temp.rows_as(6, $$UPDATE public.teams SET name = 'Roles Reds FC' WHERE id = 'd0700000-0000-4000-8000-000000000001'$$), 1, 'a dictator renames a team');
SELECT lives_ok($$SELECT pg_temp.rows_as(5, $q$INSERT INTO public.newsletter (title, summary) VALUES ('Editor post', 'x')$q$)$$, 'an editor publishes news');
SELECT is(pg_temp.rows_as(5, $$DELETE FROM public.newsletter WHERE title = 'Editor post'$$), 0, 'an editor cannot delete news');
SELECT throws_ok($$SELECT pg_temp.rows_as(1, $q$INSERT INTO public.newsletter (title, summary) VALUES ('User post', 'x')$q$)$$, '42501', NULL, 'a normal account cannot publish news');
SELECT is(pg_temp.rows_as(6, $$DELETE FROM public.newsletter WHERE title = 'Editor post'$$), 1, 'a dictator deletes news');

-- Grants and assignments --------------------------------------------------------------------------------------------
SELECT throws_ok($$SELECT pg_temp.rows_as(1, $q$INSERT INTO public.user_roles (user_id, role) VALUES ('d0b00000-0000-4000-8000-000000000001', 'dictator')$q$)$$, '42501', NULL, 'a normal account cannot grant itself a role');
SELECT throws_ok($$SELECT pg_temp.rows_as(2, $q$INSERT INTO public.scorer_assignments (user_id, season_id) VALUES ('d0b00000-0000-4000-8000-000000000002', 'd0500000-0000-4000-8000-000000000001')$q$)$$, '42501', NULL, 'a captain cannot assign scorers');
SELECT throws_ok($$SELECT pg_temp.as_user(2, $q$SELECT public.assign_captain('d0e00000-0000-4000-8000-000000000002', 'd0b00000-0000-4000-8000-000000000002')::text$q$)$$, '42501', NULL, 'only a dictator assigns captains');

-- Captain RPCs: assign, conflict, change, several entries, grant lapse ----------------------------------------------
SELECT lives_ok($$SELECT pg_temp.as_user(6, $q$SELECT public.assign_captain('d0e00000-0000-4000-8000-000000000002', 'd0b00000-0000-4000-8000-000000000009')::text$q$)$$, 'a dictator assigns a captain to a team entry');
SELECT is((SELECT count(*)::int FROM public.user_roles WHERE user_id = 'd0b00000-0000-4000-8000-000000000009' AND role = 'captain'), 1, 'assigning adds the captain grant');
SELECT throws_ok($$SELECT pg_temp.as_user(6, $q$SELECT public.assign_captain('d0e00000-0000-4000-8000-000000000002', 'd0b00000-0000-4000-8000-000000000001')::text$q$)$$, '23505', NULL, 'a second captain for the same entry is refused');
SELECT lives_ok($$SELECT pg_temp.as_user(6, $q$SELECT public.assign_captain('d0e00000-0000-4000-8000-000000000002', 'd0b00000-0000-4000-8000-000000000001', true)::text$q$)$$, 'changing the captain replaces the one assignment');
SELECT is((SELECT count(*)::int FROM public.captain_assignments WHERE team_entry_id = 'd0e00000-0000-4000-8000-000000000002'), 1, 'the entry still has one assignment');
SELECT is((SELECT count(*)::int FROM public.user_roles WHERE user_id = 'd0b00000-0000-4000-8000-000000000009' AND role = 'captain'), 0, 'the previous captain loses only the captain grant when nothing else is writable');
SELECT lives_ok($$SELECT pg_temp.as_user(6, $q$SELECT public.assign_captain('d0e00000-0000-4000-8000-000000000004', 'd0b00000-0000-4000-8000-000000000002')::text$q$)$$, 'one person captains entries in several seasons (an upcoming season can be prepared)');
SELECT is(pg_temp.as_user(2, $$SELECT public.is_captain_of('d0e00000-0000-4000-8000-000000000004')::text$$), 'true', 'an upcoming season''s entry is writable for its captain');
SELECT throws_ok($$SELECT pg_temp.as_user(6, $q$SELECT public.assign_captain('d0e00000-0000-4000-8000-000000000003', 'd0b00000-0000-4000-8000-000000000002')::text$q$)$$, '22023', NULL, 'a completed season cannot be assigned');
SELECT lives_ok($$SELECT pg_temp.as_user(6, $q$SELECT public.revoke_captain('d0e00000-0000-4000-8000-000000000001')::text$q$)$$, 'revoking one of two writable assignments');
SELECT is((SELECT count(*)::int FROM public.user_roles WHERE user_id = 'd0b00000-0000-4000-8000-000000000002' AND role = 'captain'), 1, 'keeps the captain grant while another writable assignment remains');
UPDATE public.seasons SET status = 'completed' WHERE id = 'd0500000-0000-4000-8000-000000000003';
SELECT is(pg_temp.as_user(2, $$SELECT public.is_captain_of('d0e00000-0000-4000-8000-000000000004')::text$$), 'false', 'a completed season is read-only for its captain at once');
SELECT lives_ok($$SELECT pg_temp.as_user(6, $q$SELECT public.refresh_captain_grants()::text$q$)$$, 'the lifecycle step lapses grants without a writable assignment');
SELECT is((SELECT count(*)::int FROM public.user_roles WHERE user_id = 'd0b00000-0000-4000-8000-000000000002'), 0, 'the lapsed captain keeps no other grant they never had');

-- The last dictator -------------------------------------------------------------------------------------------------
DELETE FROM public.user_roles WHERE user_id = 'd0b00000-0000-4000-8000-000000000007' AND role = 'dictator';
SELECT throws_ok($$DELETE FROM public.user_roles WHERE role = 'dictator'$$, 'P0001', NULL, 'the last dictator grant cannot be removed');

SELECT * FROM finish();
ROLLBACK;

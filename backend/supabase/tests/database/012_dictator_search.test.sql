-- Group: database. Dashboard search. account_directory labels accounts by the verified Auth email (never the
-- self-editable profile email), matches every word, looks up given ids, and returns nothing to anyone but a dictator.
-- search_players finds a full name, tells same-name players apart by their latest roster place, flags a place in the
-- season being edited, and takes LIKE wildcards literally. Rolled back.
BEGIN;
SELECT plan(14);

INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
SELECT ('ac000000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated',
       (ARRAY['sd.boss','sd.zara','sd.spoof','sd.plain'])[n] || '@iiitkottayam.ac.in', '', now(), now()
FROM generate_series(1, 4) AS n;
INSERT INTO public.user_roles (user_id, role) SELECT id, 'dictator' FROM auth.users WHERE id = 'ac000000-0000-4000-8000-000000000001' ON CONFLICT DO NOTHING;
UPDATE public.user_profiles SET real_name = 'Zara Quill' WHERE id = 'ac000000-0000-4000-8000-000000000002';
-- A user who edited their own profile email to someone else's address.
UPDATE public.user_profiles SET real_name = NULL, nickname = NULL, email = 'sd.zara@iiitkottayam.ac.in' WHERE id = 'ac000000-0000-4000-8000-000000000003';

CREATE FUNCTION pg_temp.as_user(p_n integer, p_sql text)
RETURNS SETOF text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ('ac000000-0000-4000-8000-00000000000' || p_n)::uuid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  RETURN QUERY EXECUTE p_sql;
  RESET ROLE;
END;
$$;

-- account_directory -----------------------------------------------------------------------------------------------
SELECT results_eq($$SELECT * FROM pg_temp.as_user(1, $q$SELECT label FROM public.account_directory('zara quill')$q$)$$,
  $$VALUES ('Zara Quill (sd.zara@iiitkottayam.ac.in)'::text)$$, 'every word of a name matches, labelled by name and verified email');
RESET ROLE;
SELECT results_eq($$SELECT * FROM pg_temp.as_user(1, $q$SELECT label FROM public.account_directory('sd.spoof')$q$)$$,
  $$VALUES ('sd.spoof@iiitkottayam.ac.in'::text)$$, 'a borrowed profile email is never the label; the verified email is');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM pg_temp.as_user(1, $q$SELECT label FROM public.account_directory('sd.zara')$q$)), 1,
  'searching another person''s address finds only them, not the account that copied it into its profile');
RESET ROLE;
SELECT results_eq($$SELECT * FROM pg_temp.as_user(1, $q$SELECT label FROM public.account_directory(NULL, ARRAY['ac000000-0000-4000-8000-000000000004']::uuid[])$q$)$$,
  $$VALUES ('sd.plain@iiitkottayam.ac.in'::text)$$, 'given accounts can be looked up by id to label a current selection');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM pg_temp.as_user(1, $q$SELECT label FROM public.account_directory('sd.%')$q$)), 0, 'wildcards in the query are taken literally');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM pg_temp.as_user(2, $q$SELECT label FROM public.account_directory('sd')$q$)), 0, 'an account without the dictator role gets no rows');
RESET ROLE;
SELECT ok(NOT has_function_privilege('anon', 'public.account_directory(text, uuid[], integer)', 'EXECUTE'), 'visitors cannot call the account directory');

-- search_players --------------------------------------------------------------------------------------------------
INSERT INTO public.divisions (id, slug, name, visibility) VALUES ('a0d00000-0000-4000-8000-000000000001', 'sd-div', 'Search Division', 'public');
INSERT INTO public.seasons (id, division_id, slug, name, starts_on, is_current, visibility) VALUES
  ('a0500000-0000-4000-8000-000000000001', 'a0d00000-0000-4000-8000-000000000001', '2025', 'Search 2025', '2025-01-01', false, 'public'),
  ('a0500000-0000-4000-8000-000000000002', 'a0d00000-0000-4000-8000-000000000001', '2026', 'Search 2026', '2026-01-01', true, 'public');
CREATE TEMP TABLE _sp AS SELECT 'a0500000-0000-4000-8000-000000000001'::uuid AS old_season, 'a0500000-0000-4000-8000-000000000002'::uuid AS new_season;
GRANT SELECT ON _sp TO authenticated;
INSERT INTO public.teams (id, name) VALUES ('ad000000-0000-4000-8000-000000000001', 'Search Reds'), ('ad000000-0000-4000-8000-000000000002', 'Search Blues');
INSERT INTO public.team_entries (id, team_id, season_id)
SELECT 'ae000000-0000-4000-8000-000000000001'::uuid, 'ad000000-0000-4000-8000-000000000001'::uuid, old_season FROM _sp
UNION ALL SELECT 'ae000000-0000-4000-8000-000000000002'::uuid, 'ad000000-0000-4000-8000-000000000002'::uuid, new_season FROM _sp;
SELECT set_config('request.jwt.claims', '', true); -- fixtures below are written as the seed writes them
INSERT INTO public.players (id, first_name, last_name) VALUES
  ('af000000-0000-4000-8000-000000000001', 'Quentin', 'Zebulon'),
  ('af000000-0000-4000-8000-000000000002', 'Quentin', 'Zebulon'),
  ('af000000-0000-4000-8000-000000000003', 'Percy', 'Zebulon_x');
INSERT INTO public.roster_memberships (player_id, team_entry_id, season_id, jersey_number)
SELECT 'af000000-0000-4000-8000-000000000001'::uuid, 'ae000000-0000-4000-8000-000000000001'::uuid, old_season, 4 FROM _sp
UNION ALL SELECT 'af000000-0000-4000-8000-000000000002'::uuid, 'ae000000-0000-4000-8000-000000000002'::uuid, new_season, 8 FROM _sp;

SELECT results_eq($$SELECT * FROM pg_temp.as_user(1, $q$SELECT concat_ws(' | ', first_name || ' ' || last_name, last_team, last_season, last_division, last_jersey::text, in_season::text)
                     FROM public.search_players('quentin zebulon', (SELECT new_season FROM _sp)) ORDER BY last_season$q$)$$,
  $$VALUES ('Quentin Zebulon | Search Reds | Search 2025 | Search Division | 4 | false'::text),
           ('Quentin Zebulon | Search Blues | Search 2026 | Search Division | 8 | true'::text)$$,
  'a full name finds both same-name players, told apart by their latest roster place, with the season flag');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM pg_temp.as_user(1, $q$SELECT first_name FROM public.search_players('zebulon quentin')$q$)), 2, 'word order does not matter');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM pg_temp.as_user(1, $q$SELECT first_name FROM public.search_players('zebulon_x')$q$)), 1, 'an underscore is matched literally');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM pg_temp.as_user(1, $q$SELECT first_name FROM public.search_players('zebulon%')$q$)), 0, 'a percent sign is matched literally');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM pg_temp.as_user(1, $q$SELECT first_name FROM public.search_players('z')$q$)), 0, 'a single character returns nothing');
RESET ROLE;
SELECT results_eq($$SELECT * FROM pg_temp.as_user(1, $q$SELECT coalesce(last_team, 'none') FROM public.search_players('percy')$q$)$$,
  $$VALUES ('none'::text)$$, 'a player without a roster place has no latest team');
RESET ROLE;
SELECT ok(NOT has_function_privilege('anon', 'public.search_players(text, uuid, integer)', 'EXECUTE'), 'visitors cannot call the player search');

SELECT * FROM finish();
ROLLBACK;

-- Group: database. Divisions, seasons, sections, team entries, flairs and season statistics after the legacy
-- division-string paths were retired (docs/decisions/D-01-division-season-mapping.md). Seeded local database,
-- inside a transaction that is rolled back.
BEGIN;
SELECT plan(45);

CREATE FUNCTION pg_temp.exec_as(p_role text, p_uid uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_rows integer;
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN '{}' ELSE json_build_object('sub', p_uid, 'role', p_role)::text END, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  EXECUTE p_sql;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RESET ROLE;
  RETURN 'ok:' || v_rows;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN SQLSTATE;
END;
$$;

CREATE FUNCTION pg_temp.count_as(p_role text, p_uid uuid, p_sql text)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v integer;
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN '{}' ELSE json_build_object('sub', p_uid, 'role', p_role)::text END, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  EXECUTE p_sql INTO v;
  RESET ROLE;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RAISE;
END;
$$;

-- The three existing divisions are ordinary records with one current 2026 season ----------------------------
SELECT set_eq('SELECT slug FROM public.divisions', ARRAY['super-league', 'wsl', 'freshers'], 'Super League, WSL and Freshers are division records');
SELECT is((SELECT count(*) FROM public.seasons WHERE slug = '2026' AND is_current AND status = 'active')::int, 3,
  'each division has its current, active 2026 season');
SELECT is((SELECT count(*) FROM public.divisions WHERE slug LIKE '%inter%')::int, 0, 'no Inter division is pre-created');
SELECT is((SELECT count(*) FROM public.matches)::int, 168, 'every seeded match is kept');
SELECT is((SELECT count(*) FROM public.matches m JOIN public.seasons s ON s.id = m.season_id WHERE s.slug = '2026')::int, 168,
  'every match belongs to a 2026 season');
SELECT is((SELECT count(*) FROM public.team_entries)::int, 24, 'every team is entered in its division''s 2026 season');
SELECT is((SELECT count(*) FROM public.captain_assignments ca JOIN public.team_entries e ON e.id = ca.team_entry_id)::int, (SELECT count(*) FROM public.captain_assignments)::int,
  'every captain assignment belongs to a team entry, so to a season');
SELECT is((SELECT count(*) FROM public.season_sections)::int, 3 * (SELECT count(*) FROM public.section_types)::int,
  'each season has every section configured');
SELECT ok((SELECT bool_and(starts_on IS NOT NULL AND ends_on >= starts_on) FROM public.seasons), 'season dates follow their matches');

-- The legacy division-string paths are gone -----------------------------------------------------------------
SELECT hasnt_column('public', 'teams', 'division', 'teams.division is gone');
SELECT hasnt_column('public', 'matches', 'division', 'matches.division is gone');
SELECT hasnt_column('public', 'user_profiles', 'mens_team_flair', 'the mens flair column is gone');
SELECT hasnt_column('public', 'user_profiles', 'womens_team_flair', 'the womens flair column is gone');
SELECT has_column('public', 'user_profiles', 'wc_team_flair', 'the World Cup flair stays (separate domain)');
SELECT hasnt_table('public', 'legacy_division_map', 'the legacy map is gone');
SELECT hasnt_view('public', 'top_scorers', 'top_scorers is gone');
SELECT hasnt_view('public', 'league_standings', 'league_standings is gone');
SELECT hasnt_view('public', 'league_schedule', 'league_schedule is gone');
SELECT hasnt_table('public', 'poll_options', 'poll_options is gone');
SELECT is((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
           AND p.proname IN ('backfill_legacy_divisions', 'division_model_drift', 'sync_legacy_division_season', 'enter_team_in_legacy_season',
                             'legacy_current_season', 'legacy_key_for_season', 'increment_vote'))::int, 0,
  'the compatibility and polls functions are gone');
SELECT col_not_null('public', 'matches', 'season_id', 'a match always belongs to a season');

-- D-01 season naming (kept for future backfills and documentation) ------------------------------------------
SELECT is(public.season_label('2026-08-01', '2026-12-03', '2020-01-01'), '2026', 'one calendar year -> "2026"');
SELECT is(public.season_label('2025-09-01', '2026-03-01', '2020-01-01'), '2025–26', 'two consecutive years -> "2025–26"');

-- No per-division enum or value list; seasons coexist; archive is not delete --------------------------------
SELECT is((SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
           WHERE n.nspname = 'public' AND c.contype = 'c' AND pg_get_constraintdef(c.oid) ~* '(''mens''|''womens''|''freshers''|''inter''|super-league|''wsl'')')::int, 0,
  'no check constraint anywhere names a division');
INSERT INTO public.seasons (id, division_id, slug, name) VALUES
  ('f2000000-0000-4000-8000-000000000003', (SELECT id FROM public.divisions WHERE slug = 'super-league'), '2027', '2027');
SELECT is((SELECT count(*) FROM public.seasons s JOIN public.divisions d ON d.id = s.division_id WHERE d.slug = 'super-league')::int, 2,
  'two seasons coexist in one division');
SELECT throws_ok($$INSERT INTO public.seasons (division_id, slug, name, is_current)
                   VALUES ((SELECT id FROM public.divisions WHERE slug = 'super-league'), 'dup', 'Dup', true)$$,
  '23505', NULL, 'at most one season per division is current');
SELECT throws_ok($$DELETE FROM public.seasons WHERE slug = '2026' AND division_id = (SELECT id FROM public.divisions WHERE slug = 'wsl')$$,
  '23503', NULL, 'a season that has matches cannot be deleted');
SELECT throws_ok($$DELETE FROM public.divisions WHERE slug = 'wsl'$$, '23503', NULL, 'a division that has seasons cannot be deleted');
SELECT throws_ok($$INSERT INTO public.matches (home_team_id, away_team_id) SELECT (SELECT id FROM public.teams LIMIT 1), (SELECT id FROM public.teams OFFSET 1 LIMIT 1)$$,
  '23502', NULL, 'a match cannot be created without a season');

-- Season statistics -----------------------------------------------------------------------------------------
SELECT is((SELECT sum(goals) FROM public.season_player_stats)::int, (SELECT count(*) FROM public.match_events WHERE kind = 'goal' AND player_id IS NOT NULL AND voided_at IS NULL)::int,
  'season goals add up to every attributed goal event');
SELECT is((SELECT sum(assists) FROM public.season_player_stats)::int, (SELECT count(*) FROM public.match_events WHERE assist_player_id IS NOT NULL AND voided_at IS NULL)::int,
  'season assists add up to every assist');
SELECT is((SELECT count(DISTINCT season_id) FROM public.season_player_stats)::int, 3, 'statistics are split by season');

-- Authorization ---------------------------------------------------------------------------------------------
INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
SELECT ('c4000000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated',
       (ARRAY['div.dictator', 'div.captain', 'div.editor', 'div.admin', 'div.normal'])[n] || '@iiitkottayam.ac.in', '', now(), now()
FROM generate_series(1, 5) AS n;
INSERT INTO public.user_roles (user_id, role) SELECT id, 'dictator' FROM auth.users WHERE id = 'c4000000-0000-4000-8000-000000000001' ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role) SELECT id, 'captain' FROM auth.users WHERE id = 'c4000000-0000-4000-8000-000000000002' ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role) SELECT id, 'editor' FROM auth.users WHERE id = 'c4000000-0000-4000-8000-000000000003' ON CONFLICT DO NOTHING;
DELETE FROM public.user_roles WHERE user_id = 'c4000000-0000-4000-8000-000000000004';
UPDATE public.seasons SET archived_at = now() WHERE id = 'f2000000-0000-4000-8000-000000000003';

SELECT ok(NOT has_function_privilege('anon', 'public.is_dictator()', 'EXECUTE'), 'anon cannot execute is_dictator');
SELECT is(pg_temp.exec_as('authenticated', 'c4000000-0000-4000-8000-000000000001',
  $$INSERT INTO public.divisions (slug, name, visibility) VALUES ('pradhva', 'Pradhva', 'hidden')$$), 'ok:1', 'a dictator creates a division');
SELECT is(pg_temp.exec_as('authenticated', 'c4000000-0000-4000-8000-000000000002',
  $$INSERT INTO public.divisions (slug, name) VALUES ('by-captain', 'Captain')$$), '42501', 'a captain cannot create a division');
SELECT is(pg_temp.exec_as('authenticated', 'c4000000-0000-4000-8000-000000000003',
  $$INSERT INTO public.seasons (division_id, slug, name) VALUES ((SELECT id FROM public.divisions WHERE slug = 'wsl'), 'x', 'X')$$), '42501',
  'an editor cannot create a season');
SELECT is(pg_temp.exec_as('authenticated', 'c4000000-0000-4000-8000-000000000004',
  $$INSERT INTO public.divisions (slug, name) VALUES ('by-admin', 'Admin')$$), '42501', 'a former legacy admin, now an ordinary user, gets nothing');
SELECT is(pg_temp.exec_as('authenticated', 'c4000000-0000-4000-8000-000000000005',
  $$UPDATE public.divisions SET name = 'Hacked'$$), 'ok:0', 'a normal user updates no division');
SELECT is(pg_temp.exec_as('anon', NULL, $$INSERT INTO public.divisions (slug, name) VALUES ('by-anon', 'Anon')$$), '42501',
  'anon cannot create a division');
SELECT is(pg_temp.count_as('anon', NULL, $$SELECT count(*) FROM public.divisions WHERE slug = 'pradhva'$$), 0, 'anon cannot see a hidden division');
SELECT is(pg_temp.count_as('authenticated', 'c4000000-0000-4000-8000-000000000005',
  $$SELECT count(*) FROM public.seasons WHERE id = 'f2000000-0000-4000-8000-000000000003'$$), 0, 'a normal user cannot see an archived season');
SELECT is(pg_temp.count_as('authenticated', 'c4000000-0000-4000-8000-000000000001',
  $$SELECT count(*) FROM public.seasons WHERE id = 'f2000000-0000-4000-8000-000000000003'$$), 1, 'a dictator sees an archived season');

-- Division flairs: a user manages only their own -------------------------------------------------------------
SELECT is(pg_temp.exec_as('authenticated', 'c4000000-0000-4000-8000-000000000005',
  $$INSERT INTO public.division_flairs (user_id, division_id, team_name) VALUES ('c4000000-0000-4000-8000-000000000005', (SELECT id FROM public.divisions WHERE slug = 'wsl'), 'Falcone Family')$$),
  'ok:1', 'a user sets their own flair for a division');
SELECT is(pg_temp.exec_as('authenticated', 'c4000000-0000-4000-8000-000000000005',
  $$INSERT INTO public.division_flairs (user_id, division_id, team_name) VALUES ('c4000000-0000-4000-8000-000000000002', (SELECT id FROM public.divisions WHERE slug = 'wsl'), 'Falcone Family')$$),
  '42501', 'a user cannot set someone else''s flair');
SELECT is(pg_temp.count_as('anon', NULL, $$SELECT count(*) FROM public.division_flairs WHERE user_id = 'c4000000-0000-4000-8000-000000000005'$$), 1,
  'flairs are public, like profiles');

SELECT * FROM finish();
ROLLBACK;

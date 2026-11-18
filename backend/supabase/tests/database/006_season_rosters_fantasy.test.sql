-- Group: database. Rosters and fantasy points belong to a season: every player is on a team's season roster (a roster membership), and a
-- user's fantasy points in a season are the sum of their predictions on that season's matches. Rolled back.
BEGIN;
SELECT plan(14);

CREATE FUNCTION pg_temp.rows_as(p_role text, p_uid uuid, p_sql text)
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

-- Rosters ---------------------------------------------------------------------------------------------------
SELECT is((SELECT count(*) FROM public.players p WHERE NOT EXISTS (SELECT 1 FROM public.roster_memberships rm WHERE rm.player_id = p.id))::int, 0,
  'every seeded player is on a season roster');
SELECT is((SELECT count(DISTINCT rm.player_id) FROM public.roster_memberships rm JOIN public.seasons s ON s.id = rm.season_id WHERE s.slug = '2026')::int, 192,
  'every player is on a 2026 roster');
SELECT throws_ok($$DELETE FROM public.team_entries WHERE id = (SELECT team_entry_id FROM public.roster_memberships LIMIT 1)$$, '23503', NULL,
  'a season entry with a roster cannot be deleted');

-- Fantasy points --------------------------------------------------------------------------------------------
SELECT hasnt_column('public', 'user_profiles', 'points', 'the cross-division points total is gone');
SELECT is((SELECT sum(points) FROM public.season_fantasy_points)::int, (SELECT sum(COALESCE(points_awarded, 0)) FROM public.predictions)::int,
  'season points add up to every awarded point');
SELECT is((SELECT count(DISTINCT season_id) FROM public.season_fantasy_points)::int, 3, 'points are split by season');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM public.season_fantasy_points f
  WHERE f.points <> (SELECT COALESCE(sum(p.points_awarded), 0) FROM public.predictions p JOIN public.matches m ON m.id = p.match_id
                     WHERE p.user_id = f.user_id AND m.season_id = f.season_id)), 'each season total is that season''s predictions only');

-- A second season: a prediction there changes only that season.
INSERT INTO public.seasons (id, division_id, slug, name) VALUES
  ('f6000000-0000-4000-8000-000000000001', (SELECT id FROM public.divisions WHERE slug = 'wsl'), '2027', '2027');
INSERT INTO public.matches (id, home_team_id, away_team_id, season_id, status)
SELECT 'f6100000-0000-4000-8000-000000000001', (SELECT id FROM public.teams ORDER BY id LIMIT 1), (SELECT id FROM public.teams ORDER BY id OFFSET 1 LIMIT 1),
       'f6000000-0000-4000-8000-000000000001', 'completed';
CREATE TEMP TABLE before_2026 AS
SELECT user_id, season_id, points FROM public.season_fantasy_points WHERE user_id = '60000000-0000-4000-8000-000000000001';
INSERT INTO public.predictions (user_id, match_id, predicted_home_score, predicted_away_score, points_awarded, status)
VALUES ('60000000-0000-4000-8000-000000000001', 'f6100000-0000-4000-8000-000000000001', 1, 0, 9, 'graded');
SELECT is((SELECT points FROM public.season_fantasy_points WHERE user_id = '60000000-0000-4000-8000-000000000001'
           AND season_id = 'f6000000-0000-4000-8000-000000000001'), 9, 'the new season has its own points');
SELECT set_eq($$SELECT user_id, season_id, points FROM public.season_fantasy_points
                WHERE user_id = '60000000-0000-4000-8000-000000000001' AND season_id <> 'f6000000-0000-4000-8000-000000000001'$$,
  $$SELECT user_id, season_id, points FROM before_2026$$, 'the 2026 seasons are unchanged');

-- The public leaderboard function: season totals only, public seasons only.
SELECT is((SELECT points FROM public.season_fantasy_leaderboard('f6000000-0000-4000-8000-000000000001') WHERE user_id = '60000000-0000-4000-8000-000000000001'), 9,
  'the leaderboard function ranks a season');
SELECT is(pg_temp.rows_as('anon', NULL, $$SELECT count(*)::int FROM public.season_fantasy_leaderboard('f6000000-0000-4000-8000-000000000001')$$), 1,
  'anyone can read a public season''s leaderboard (totals only)');
SELECT is(pg_temp.rows_as('anon', NULL, $$SELECT count(*)::int FROM public.predictions$$), 0,
  'predictions themselves stay private to their owner');
UPDATE public.seasons SET visibility = 'hidden' WHERE id = 'f6000000-0000-4000-8000-000000000001';
SELECT is(pg_temp.rows_as('anon', NULL, $$SELECT count(*)::int FROM public.season_fantasy_leaderboard('f6000000-0000-4000-8000-000000000001')$$), 0,
  'a hidden season has no public leaderboard');
SELECT is((SELECT c FROM pg_proc p, unnest(p.proconfig) c WHERE p.oid = 'public.season_fantasy_leaderboard(uuid,integer)'::regprocedure AND c LIKE 'search_path=%'),
  'search_path=""', 'the leaderboard function pins an empty search_path');

SELECT * FROM finish();
ROLLBACK;

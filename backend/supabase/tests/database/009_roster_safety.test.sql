-- Group: database. The dictator's multi-write roster actions are single transactions, and roster history cannot be
-- moved: create_team_in_season creates the team and its season entry together; delete_unplayed_player removes a
-- player only when they never played (no other season, no goal or assist, own goals included) and otherwise changes
-- nothing; a roster place with goals or assists cannot be moved to another player or season. Rolled back.
BEGIN;
SELECT plan(14);

INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
SELECT ('a9000000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated',
       (ARRAY['rs.dictator','rs.captain'])[n] || '@iiitkottayam.ac.in', '', now(), now()
FROM generate_series(1, 2) AS n;
UPDATE public.user_roles SET role = 'dictator' WHERE user_id = 'a9000000-0000-4000-8000-000000000001';
UPDATE public.user_roles SET role = 'captain'  WHERE user_id = 'a9000000-0000-4000-8000-000000000002';

CREATE FUNCTION pg_temp.as_user(p_n integer, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
  v_uid uuid := ('a9000000-0000-4000-8000-00000000000' || p_n)::uuid;
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

CREATE TEMP TABLE _s AS SELECT id FROM public.seasons WHERE is_current ORDER BY id LIMIT 1;
GRANT SELECT ON _s TO authenticated;

-- create_team_in_season --------------------------------------------------------------------------------------
SELECT ok(pg_temp.as_user(1, $q$SELECT public.create_team_in_season((SELECT id FROM _s), '  Safety Rovers ')::text$q$) IS NOT NULL,
  'a dictator creates a team in a season in one step');
SELECT results_eq($$SELECT t.name::text, t.short_name::text FROM public.teams t JOIN public.team_entries e ON e.team_id = t.id
                    WHERE t.name = 'Safety Rovers' AND e.season_id = (SELECT id FROM _s)$$,
  $$VALUES ('Safety Rovers'::text, 'SAFE'::text)$$, 'the team and its season entry exist together');
SELECT throws_ok($$SELECT pg_temp.as_user(2, $q$SELECT public.create_team_in_season((SELECT id FROM _s), 'Captain FC')::text$q$)$$,
  '42501', 'Only a dictator can add teams to a season', 'a captain cannot add teams');
SELECT throws_ok($$SELECT pg_temp.as_user(1, $q$SELECT public.create_team_in_season('00000000-0000-4000-8000-000000000000', 'Nowhere FC')::text$q$)$$,
  'P0002', 'Season not found', 'an unknown season changes nothing');
SELECT is((SELECT count(*) FROM public.teams WHERE name IN ('Captain FC', 'Nowhere FC'))::int, 0, 'no orphan team was left by a refused call');

-- delete_unplayed_player ---------------------------------------------------------------------------------------
CREATE TEMP TABLE _p AS
SELECT public.create_rostered_player((SELECT id FROM public.team_entries WHERE season_id = (SELECT id FROM _s) ORDER BY id LIMIT 1), 'Never', 'Played', 97) AS fresh;
GRANT SELECT ON _p TO authenticated;
SELECT throws_ok($$SELECT pg_temp.as_user(2, $q$SELECT public.delete_unplayed_player((SELECT fresh FROM _p))::text$q$)$$,
  '42501', 'Only a dictator can delete players', 'a captain cannot delete players');
SELECT lives_ok($$SELECT pg_temp.as_user(1, $q$SELECT public.delete_unplayed_player((SELECT fresh FROM _p))::text$q$)$$,
  'a dictator deletes a player who never played');
SELECT is((SELECT count(*) FROM public.players WHERE id = (SELECT fresh FROM _p))::int, 0, 'the player and their roster place are gone');

-- A player whose only goal is an own goal still has match history.
CREATE TEMP TABLE _og AS
SELECT public.create_rostered_player((SELECT id FROM public.team_entries WHERE season_id = (SELECT id FROM _s) ORDER BY id LIMIT 1), 'Own', 'Goal', 96) AS p;
GRANT SELECT ON _og TO authenticated;
INSERT INTO public.goals (match_id, player_id, team_id, is_own_goal)
SELECT (SELECT id FROM public.matches WHERE season_id = (SELECT id FROM _s) ORDER BY id LIMIT 1), p,
       (SELECT team_id FROM public.team_entries WHERE season_id = (SELECT id FROM _s) ORDER BY id LIMIT 1), true FROM _og;
SELECT throws_ok($$SELECT pg_temp.as_user(1, $q$SELECT public.delete_unplayed_player((SELECT p FROM _og))::text$q$)$$,
  '23503', 'This player has match history, so the player is kept', 'an own-goal scorer is kept');
SELECT is((SELECT count(*) FROM public.roster_memberships WHERE player_id = (SELECT p FROM _og))::int, 1, 'and keeps their roster place: nothing changed');

-- A player in two seasons is kept.
SELECT throws_ok($$SELECT pg_temp.as_user(1, $q$SELECT public.delete_unplayed_player((SELECT player_id FROM public.roster_memberships GROUP BY player_id HAVING count(*) > 1 LIMIT 1))::text$q$)$$,
  '23503', NULL, 'a player who plays in another season is kept');

-- roster history cannot be moved ---------------------------------------------------------------------------------
CREATE TEMP TABLE _h AS
SELECT rm.id, rm.season_id FROM public.roster_memberships rm
JOIN public.season_player_stats s ON s.player_id = rm.player_id AND s.season_id = rm.season_id AND s.goals > 0 LIMIT 1;
SELECT throws_ok($$UPDATE public.roster_memberships SET player_id = (SELECT p FROM _og) WHERE id = (SELECT id FROM _h)$$,
  '23503', NULL, 'a roster place with goals cannot be handed to another player');
-- An empty team in the same season to move to (so no jersey number can clash).
INSERT INTO public.teams (id, name) VALUES ('a9100000-0000-4000-8000-000000000001', 'Safety Movers');
INSERT INTO public.team_entries (id, team_id, season_id)
SELECT 'a9200000-0000-4000-8000-000000000001', 'a9100000-0000-4000-8000-000000000001', season_id FROM _h;
SELECT lives_ok($$UPDATE public.roster_memberships SET team_entry_id = 'a9200000-0000-4000-8000-000000000001' WHERE id = (SELECT id FROM _h)$$,
  'moving it to another team in the same season is still allowed');
SELECT lives_ok($$UPDATE public.roster_memberships SET jersey_number = 88 WHERE id = (SELECT id FROM _h)$$, 'and so is changing its jersey number');

SELECT * FROM finish();
ROLLBACK;

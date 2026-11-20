-- Group: database (match-operations). Canonical match events (D-08): events are the source of truth and the score is a
-- cache maintained by the database. Covers the schema and constraints, validation against the match and roster, the
-- ban on deletion, the score cache and its guard (every role), awarded results, column grants, the access matrix (anon,
-- normal user, captain, scorer assigned elsewhere, assigned scorer, dictator), audit, the needs-regrade flag and the
-- statistics view. Rolled back.
BEGIN;
SELECT plan(56);

-- Structure ---------------------------------------------------------------------------------------------------------
SELECT has_table('public', 'match_events', 'match events exist');
SELECT hasnt_table('public', 'goals', 'the goals table is retired');
SELECT hasnt_column('public', 'matches', 'scorers', 'the match JSON scorers column is retired');
SELECT hasnt_column('public', 'matches', 'own_goals', 'the match JSON own_goals column is retired');
SELECT has_column('public', 'matches', 'result_kind', 'matches carry an awarded result kind');
SELECT has_function('public', 'award_match_result', ARRAY['uuid', 'text', 'integer', 'integer', 'text'], 'awarded results have one writer');

-- Fixture: two seeded teams of one current season, their matches, accounts ------------------------------------------
CREATE TEMP TABLE _w AS
SELECT s.id AS season_id, e1.team_id AS ta, e2.team_id AS tb, e1.id AS ea, e2.id AS eb
FROM public.seasons s JOIN public.divisions d ON d.id = s.division_id AND d.slug = 'wsl'
JOIN LATERAL (SELECT id, team_id FROM public.team_entries WHERE season_id = s.id ORDER BY id LIMIT 1) e1 ON true
JOIN LATERAL (SELECT id, team_id FROM public.team_entries WHERE season_id = s.id ORDER BY id OFFSET 1 LIMIT 1) e2 ON true
WHERE s.is_current;
GRANT SELECT ON _w TO authenticated;
CREATE TEMP TABLE _p AS
SELECT (SELECT player_id FROM public.roster_memberships WHERE team_entry_id = (SELECT ea FROM _w) ORDER BY jersey_number, player_id LIMIT 1) AS a1,
       (SELECT player_id FROM public.roster_memberships WHERE team_entry_id = (SELECT ea FROM _w) ORDER BY jersey_number, player_id OFFSET 1 LIMIT 1) AS a2,
       (SELECT player_id FROM public.roster_memberships WHERE team_entry_id = (SELECT eb FROM _w) ORDER BY jersey_number, player_id LIMIT 1) AS b1;
GRANT SELECT ON _p TO authenticated;
INSERT INTO public.matches (id, home_team_id, away_team_id, season_id, status, date) VALUES
  ('e0300000-0000-4000-8000-000000000001', (SELECT ta FROM _w), (SELECT tb FROM _w), (SELECT season_id FROM _w), 'live', now()),
  ('e0300000-0000-4000-8000-000000000002', (SELECT tb FROM _w), (SELECT ta FROM _w), (SELECT season_id FROM _w), 'scheduled', now() + interval '1 day');
INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
SELECT ('e0b00000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated', 'me.user' || n || '@iiitkottayam.ac.in', '', now(), now()
FROM generate_series(1, 5) AS n;
-- 1 normal, 2 captain, 3 scorer assigned to match 1, 4 scorer assigned to match 2 only, 5 dictator
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e0b00000-0000-4000-8000-000000000002', 'captain'), ('e0b00000-0000-4000-8000-000000000003', 'scorer'),
  ('e0b00000-0000-4000-8000-000000000004', 'scorer'), ('e0b00000-0000-4000-8000-000000000005', 'dictator');
INSERT INTO public.scorer_assignments (user_id, match_id) VALUES
  ('e0b00000-0000-4000-8000-000000000003', 'e0300000-0000-4000-8000-000000000001'),
  ('e0b00000-0000-4000-8000-000000000004', 'e0300000-0000-4000-8000-000000000002');
INSERT INTO public.captain_assignments (team_entry_id, user_id) VALUES ((SELECT ea FROM _w), 'e0b00000-0000-4000-8000-000000000002');

CREATE FUNCTION pg_temp.as_user(p_n integer, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  IF p_n IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', ('e0b00000-0000-4000-8000-00000000000' || p_n)::uuid, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', ('e0b00000-0000-4000-8000-00000000000' || p_n), true);
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
CREATE FUNCTION pg_temp.score(p_match text) RETURNS text LANGUAGE sql AS
  $$SELECT home_score || '-' || away_score FROM public.matches WHERE id = p_match::uuid$$;
CREATE FUNCTION pg_temp.ev(p_user integer, p_values text) RETURNS text LANGUAGE sql AS
  $$SELECT pg_temp.as_user(p_user, 'INSERT INTO public.match_events (id, match_id, team_id, kind, player_id, assist_player_id, minute) VALUES ' || p_values || ' RETURNING id::text')$$;

SELECT is(pg_temp.score('e0300000-0000-4000-8000-000000000001'), '0-0', 'a new match starts at 0-0');

-- Access: who may record events --------------------------------------------------------------------------------------
SELECT throws_ok($$SELECT pg_temp.ev(NULL, format('(%L, %L, %L, %L, NULL, NULL, 5)', 'e0100000-0000-4000-8000-000000000001', 'e0300000-0000-4000-8000-000000000001', (SELECT ta FROM _w), 'goal'))$$, '42501', NULL, 'an anonymous visitor cannot record an event');
SELECT throws_ok($$SELECT pg_temp.ev(1, format('(%L, %L, %L, %L, NULL, NULL, 5)', 'e0100000-0000-4000-8000-000000000001', 'e0300000-0000-4000-8000-000000000001', (SELECT ta FROM _w), 'goal'))$$, '42501', NULL, 'a normal account cannot record an event');
SELECT throws_ok($$SELECT pg_temp.ev(2, format('(%L, %L, %L, %L, NULL, NULL, 5)', 'e0100000-0000-4000-8000-000000000001', 'e0300000-0000-4000-8000-000000000001', (SELECT ta FROM _w), 'goal'))$$, '42501', NULL, 'a captain cannot record an event, even for their own team');
SELECT throws_ok($$SELECT pg_temp.ev(4, format('(%L, %L, %L, %L, NULL, NULL, 5)', 'e0100000-0000-4000-8000-000000000001', 'e0300000-0000-4000-8000-000000000001', (SELECT ta FROM _w), 'goal'))$$, '42501', NULL, 'a scorer assigned to another match cannot record an event');
SELECT lives_ok($$SELECT pg_temp.ev(3, format('(%L, %L, %L, %L, %L, NULL, 5)', 'e0100000-0000-4000-8000-000000000001', 'e0300000-0000-4000-8000-000000000001', (SELECT ta FROM _w), 'goal', (SELECT a1 FROM _p)))$$, 'the assigned scorer records a goal');
SELECT is(pg_temp.score('e0300000-0000-4000-8000-000000000001'), '1-0', 'the score cache follows the event');
SELECT lives_ok($$SELECT pg_temp.ev(5, format('(%L, %L, %L, %L, NULL, NULL, 40)', 'e0100000-0000-4000-8000-000000000002', 'e0300000-0000-4000-8000-000000000001', (SELECT tb FROM _w), 'goal'))$$, 'a dictator records an unattributed goal');
SELECT is(pg_temp.score('e0300000-0000-4000-8000-000000000001'), '1-1', 'an unattributed goal counts toward the score');
SELECT is(pg_temp.as_user(NULL, $$SELECT count(*)::text FROM public.match_events WHERE match_id = 'e0300000-0000-4000-8000-000000000001'$$), '2', 'anyone can read the events');

-- Validation --------------------------------------------------------------------------------------------------------
SELECT throws_ok($$SELECT pg_temp.ev(5, format('(%L, %L, %L, %L, NULL, NULL, 5)', 'e0100000-0000-4000-8000-000000000009', 'e0300000-0000-4000-8000-000000000001', (SELECT id FROM public.teams WHERE id NOT IN ((SELECT ta FROM _w), (SELECT tb FROM _w)) LIMIT 1), 'goal'))$$, '23514', 'The team is not playing in this match', 'the team must be playing in the match');
SELECT throws_ok($$SELECT pg_temp.ev(5, format('(%L, %L, %L, %L, %L, NULL, 5)', 'e0100000-0000-4000-8000-000000000009', 'e0300000-0000-4000-8000-000000000001', (SELECT ta FROM _w), 'goal', (SELECT b1 FROM _p)))$$, '23514', 'The player is not on this team''s roster for the match''s season', 'the scorer must be on the team''s roster');
SELECT throws_ok($$SELECT pg_temp.ev(5, format('(%L, %L, %L, %L, %L, %L, 5)', 'e0100000-0000-4000-8000-000000000009', 'e0300000-0000-4000-8000-000000000001', (SELECT ta FROM _w), 'goal', (SELECT a1 FROM _p), (SELECT b1 FROM _p)))$$, '23514', 'The assisting player is not on this team''s roster for the match''s season', 'the assister must be on the team''s roster');
SELECT throws_ok($$SELECT pg_temp.ev(5, format('(%L, %L, %L, %L, %L, %L, 5)', 'e0100000-0000-4000-8000-000000000009', 'e0300000-0000-4000-8000-000000000001', (SELECT ta FROM _w), 'goal', (SELECT a1 FROM _p), (SELECT a1 FROM _p)))$$, '23514', NULL, 'the assister is never the scorer');
SELECT throws_ok($$SELECT pg_temp.ev(5, format('(%L, %L, %L, %L, NULL, NULL, 5)', 'e0100000-0000-4000-8000-000000000009', 'e0300000-0000-4000-8000-000000000001', (SELECT ta FROM _w), 'yellow'))$$, '23514', NULL, 'a card needs a player');
SELECT throws_ok($$SELECT pg_temp.ev(5, format('(%L, %L, %L, %L, %L, %L, 5)', 'e0100000-0000-4000-8000-000000000009', 'e0300000-0000-4000-8000-000000000001', (SELECT ta FROM _w), 'yellow', (SELECT a1 FROM _p), (SELECT a2 FROM _p)))$$, '23514', NULL, 'only a goal has an assist');
SELECT throws_ok($$SELECT pg_temp.ev(5, format('(%L, %L, %L, %L, NULL, NULL, 200)', 'e0100000-0000-4000-8000-000000000009', 'e0300000-0000-4000-8000-000000000001', (SELECT ta FROM _w), 'goal'))$$, '23514', NULL, 'a minute is 0 to 150');

-- Own goals, cards, corrections ---------------------------------------------------------------------------------------
SELECT lives_ok($$SELECT pg_temp.ev(3, format('(%L, %L, %L, %L, %L, NULL, 60)', 'e0100000-0000-4000-8000-000000000003', 'e0300000-0000-4000-8000-000000000001', (SELECT ta FROM _w), 'own_goal', (SELECT a2 FROM _p)))$$, 'a scorer records an own goal');
SELECT is(pg_temp.score('e0300000-0000-4000-8000-000000000001'), '1-2', 'an own goal counts for the opposition');
SELECT lives_ok($$SELECT pg_temp.ev(3, format('(%L, %L, %L, %L, %L, NULL, 70)', 'e0100000-0000-4000-8000-000000000004', 'e0300000-0000-4000-8000-000000000001', (SELECT ta FROM _w), 'yellow', (SELECT a2 FROM _p)))$$, 'a scorer records a yellow card');
SELECT is(pg_temp.score('e0300000-0000-4000-8000-000000000001'), '1-2', 'a card does not change the score');
SELECT lives_ok($$SELECT pg_temp.as_user(3, $q$UPDATE public.match_events SET player_id = (SELECT b1 FROM _p), assist_player_id = NULL, minute = 41 WHERE id = 'e0100000-0000-4000-8000-000000000002' RETURNING id::text$q$)$$, 'the unattributed goal is attributed later');
SELECT is((SELECT version FROM public.match_events WHERE id = 'e0100000-0000-4000-8000-000000000002'), 2, 'an edit increments the version');
SELECT is(pg_temp.score('e0300000-0000-4000-8000-000000000001'), '1-2', 'attribution does not change the score');
SELECT lives_ok($$SELECT pg_temp.as_user(3, $q$UPDATE public.match_events SET voided_at = now(), void_reason = 'wrong team' WHERE id = 'e0100000-0000-4000-8000-000000000003' RETURNING id::text$q$)$$, 'a scorer voids an event with a reason');
SELECT is(pg_temp.score('e0300000-0000-4000-8000-000000000001'), '1-1', 'voiding takes the goal off the score');
SELECT throws_ok($$SELECT pg_temp.as_user(3, $q$UPDATE public.match_events SET minute = 9 WHERE id = 'e0100000-0000-4000-8000-000000000003' RETURNING id::text$q$)$$, '23514', 'A voided event cannot be edited', 'a voided event cannot be edited');
SELECT throws_ok($$UPDATE public.match_events SET voided_at = now(), void_reason = '' WHERE id = 'e0100000-0000-4000-8000-000000000001'$$, '23514', NULL, 'a void needs a reason');
SELECT throws_ok($$UPDATE public.match_events SET match_id = 'e0300000-0000-4000-8000-000000000002' WHERE id = 'e0100000-0000-4000-8000-000000000001'$$, '23514', 'An event cannot move to another match', 'an event stays on its match');
SELECT throws_ok($$DELETE FROM public.match_events WHERE id = 'e0100000-0000-4000-8000-000000000001'$$, '42501', 'A match event is voided, never deleted', 'an event cannot be deleted (any role)');
SELECT throws_ok($$TRUNCATE public.match_events$$, '42501', NULL, 'the history cannot be truncated');

-- The score guard ---------------------------------------------------------------------------------------------------
SELECT throws_ok($$UPDATE public.matches SET home_score = 9 WHERE id = 'e0300000-0000-4000-8000-000000000001'$$, '23514', 'The score follows the match events; record or correct a goal instead', 'the score cannot be written directly (even by the server)');
SELECT throws_ok($$SELECT pg_temp.as_user(3, $q$UPDATE public.matches SET home_score = 9 WHERE id = 'e0300000-0000-4000-8000-000000000001' RETURNING 'x'$q$)$$, '42501', NULL, 'an assigned scorer has no right to the score columns');
SELECT lives_ok($$SELECT pg_temp.as_user(3, $q$UPDATE public.matches SET minute = '55''' WHERE id = 'e0300000-0000-4000-8000-000000000001' RETURNING 'x'$q$)$$, 'but the clock and status stay with the scorer');
SELECT throws_ok($$INSERT INTO public.matches (home_team_id, away_team_id, season_id, home_score) VALUES ((SELECT ta FROM _w), (SELECT tb FROM _w), (SELECT season_id FROM _w), 2)$$, '23514', NULL, 'a new match starts at 0-0');
SELECT throws_ok($$UPDATE public.matches SET home_team_id = away_team_id WHERE id = 'e0300000-0000-4000-8000-000000000001'$$, '23514', 'The teams of a match cannot change once it has events', 'the teams cannot change once events exist');

-- Awarded results ---------------------------------------------------------------------------------------------------
SELECT throws_ok($$SELECT pg_temp.as_user(3, $q$SELECT public.award_match_result('e0300000-0000-4000-8000-000000000002', 'walkover', 3, 0, 'no show')::text$q$)$$, '42501', 'Only a dictator can award a result', 'a scorer cannot award a result');
SELECT throws_ok($$SELECT pg_temp.as_user(5, $q$SELECT public.award_match_result('e0300000-0000-4000-8000-000000000002', 'walkover', 3, 0, '  ')::text$q$)$$, '22023', 'An awarded result needs a reason', 'an awarded result needs a reason');
SELECT throws_ok($$SELECT pg_temp.as_user(5, $q$SELECT public.award_match_result('e0300000-0000-4000-8000-000000000001', 'walkover', 3, 0, 'no show')::text$q$)$$, '23514', NULL, 'a match with goal events cannot be awarded');
SELECT lives_ok($$SELECT pg_temp.as_user(5, $q$SELECT public.award_match_result('e0300000-0000-4000-8000-000000000002', 'walkover', 3, 0, 'opponent did not turn up')::text$q$)$$, 'a dictator awards a walkover');
SELECT is(pg_temp.score('e0300000-0000-4000-8000-000000000002'), '3-0', 'the awarded score is stored (3-0 is only the default)');
SELECT is((SELECT status || ':' || result_kind FROM public.matches WHERE id = 'e0300000-0000-4000-8000-000000000002'), 'completed:walkover', 'an awarded match is completed and labelled');
SELECT throws_ok($$SELECT pg_temp.ev(5, format('(%L, %L, %L, %L, NULL, NULL, 5)', 'e0100000-0000-4000-8000-000000000010', 'e0300000-0000-4000-8000-000000000002', (SELECT ta FROM _w), 'goal'))$$, '23514', 'An awarded result (walkover or forfeit) has no match events', 'an awarded result has no events');

-- Audit, regrade flag, statistics ------------------------------------------------------------------------------------
SELECT ok(EXISTS (SELECT 1 FROM public.audit_log WHERE table_name = 'match_events' AND actor_id = 'e0b00000-0000-4000-8000-000000000003'), 'event changes are audited with the scorer as actor');
SELECT ok(EXISTS (SELECT 1 FROM public.audit_log WHERE table_name = 'matches' AND record_id = 'e0300000-0000-4000-8000-000000000001' AND changes ? 'home_score' AND actor_id = 'e0b00000-0000-4000-8000-000000000003'), 'the score change is audited with the person who caused it');
INSERT INTO public.predictions (user_id, match_id, predicted_home_score, predicted_away_score, points_awarded, status, graded_events_version)
SELECT 'e0b00000-0000-4000-8000-000000000001', 'e0300000-0000-4000-8000-000000000001', 1, 1, 100, 'graded', (SELECT events_version FROM public.matches WHERE id = 'e0300000-0000-4000-8000-000000000001');
UPDATE public.matches SET is_graded = true WHERE id = 'e0300000-0000-4000-8000-000000000001';
SELECT is((SELECT count(*)::int FROM public.matches_needing_regrade((SELECT season_id FROM _w)) m WHERE m = 'e0300000-0000-4000-8000-000000000001'), 0, 'a graded match with unchanged events needs no regrade');
SELECT lives_ok($$SELECT pg_temp.ev(3, format('(%L, %L, %L, %L, %L, NULL, 80)', 'e0100000-0000-4000-8000-000000000005', 'e0300000-0000-4000-8000-000000000001', (SELECT ta FROM _w), 'goal', (SELECT a1 FROM _p)))$$, 'a correction after grading');
SELECT is((SELECT count(*)::int FROM public.matches_needing_regrade((SELECT season_id FROM _w)) m WHERE m = 'e0300000-0000-4000-8000-000000000001'), 1, 'the corrected match needs a regrade');
SELECT is((SELECT goals FROM public.season_player_stats WHERE player_id = (SELECT a1 FROM _p) AND season_id = (SELECT season_id FROM _w)), (SELECT count(*)::int FROM public.match_events WHERE player_id = (SELECT a1 FROM _p) AND kind = 'goal' AND voided_at IS NULL), 'the statistics line counts the player''s non-voided goals');
SELECT is((SELECT yellow_cards FROM public.season_player_stats WHERE player_id = (SELECT a2 FROM _p) AND season_id = (SELECT season_id FROM _w)), 1, 'cards appear in the season line');

SELECT * FROM finish();
ROLLBACK;

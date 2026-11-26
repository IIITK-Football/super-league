-- Group: database (fantasy). Grading runs in the database (D-04): grade_match grades every prediction of a completed
-- match in one call and regrade_all_predictions regrades every graded match. Only a dictator may call them; they pin
-- an empty search_path; anon cannot execute them; the points follow the documented rule; and grading records the
-- events version it graded at. Rolled back.
BEGIN;
SELECT plan(14);

SELECT has_function('public', 'grade_match', ARRAY['uuid', 'boolean'], 'grading is one database function');
SELECT has_function('public', 'regrade_all_predictions', ARRAY[]::text[], 'regrading is one database function');
SELECT is_definer('public', 'grade_match', ARRAY['uuid', 'boolean'], 'grade_match checks the caller itself');
SELECT ok((SELECT bool_and(p.proconfig @> ARRAY['search_path=""']) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname IN ('grade_match', 'regrade_all_predictions', 'prediction_points', 'prediction_player_hits')),
  'all grading functions pin an empty search_path');
SELECT ok(NOT has_function_privilege('anon', 'public.grade_match(uuid, boolean)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.regrade_all_predictions()', 'EXECUTE'), 'anon cannot grade');

-- The points rule
SELECT is(public.prediction_points(2, 1, '[]', '[]', 2, 1, NULL, NULL), 300, 'an exact scoreline is 300');
SELECT is(public.prediction_points(1, 0, '[]', '[]', 3, 1, NULL, NULL), 70, 'the right outcome is 100 minus 10 per goal of difference');
SELECT is(public.prediction_points(0, 1, '[]', '[]', 2, 0, NULL, NULL), -30, 'the wrong outcome only loses the difference');
SELECT is(public.prediction_points(1, 0, '["11111111-1111-4111-8111-111111111111","11111111-1111-4111-8111-111111111111"]', 'null', 1, 0,
          ARRAY['11111111-1111-4111-8111-111111111111']::uuid[], NULL), 400, 'a scorer counts at most as often as they scored; a non-array prediction counts nothing');

-- Fixture: a completed match of a seeded season with one prediction
CREATE TEMP TABLE _w AS
SELECT s.id AS season_id, e1.team_id AS ta, e2.team_id AS tb
FROM public.seasons s JOIN public.divisions d ON d.id = s.division_id AND d.slug = 'wsl'
JOIN LATERAL (SELECT team_id FROM public.team_entries WHERE season_id = s.id ORDER BY id LIMIT 1) e1 ON true
JOIN LATERAL (SELECT team_id FROM public.team_entries WHERE season_id = s.id ORDER BY id OFFSET 1 LIMIT 1) e2 ON true
WHERE s.is_current;
INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
SELECT ('e2400000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated', 'gr.user' || n || '@iiitkottayam.ac.in', '', now(), now()
FROM generate_series(1, 2) AS n;
INSERT INTO public.user_roles (user_id, role) VALUES ('e2400000-0000-4000-8000-000000000002', 'dictator');
INSERT INTO public.matches (id, home_team_id, away_team_id, season_id, status, date)
VALUES ('e2410000-0000-4000-8000-000000000001', (SELECT ta FROM _w), (SELECT tb FROM _w), (SELECT season_id FROM _w), 'scheduled', now() + interval '1 day');
INSERT INTO public.predictions (user_id, match_id, predicted_home_score, predicted_away_score, predicted_scorers, predicted_assists, status)
VALUES ('e2400000-0000-4000-8000-000000000001', 'e2410000-0000-4000-8000-000000000001', 0, 0, '[]', '[]', 'pending');

CREATE FUNCTION pg_temp.as_user(p_n integer, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ('e2400000-0000-4000-8000-00000000000' || p_n)::uuid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', ('e2400000-0000-4000-8000-00000000000' || p_n), true);
  SET LOCAL ROLE authenticated;
  EXECUTE p_sql INTO v;
  RESET ROLE;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RAISE;
END;
$$;

SELECT throws_ok($$SELECT pg_temp.as_user(2, 'SELECT public.grade_match(''e2410000-0000-4000-8000-000000000001'')::text')$$,
  '22023', NULL, 'a match that is not completed cannot be graded');
UPDATE public.matches SET status = 'completed' WHERE id = 'e2410000-0000-4000-8000-000000000001';
SELECT throws_ok($$SELECT pg_temp.as_user(1, 'SELECT public.grade_match(''e2410000-0000-4000-8000-000000000001'')::text')$$,
  '42501', NULL, 'a normal user cannot grade');
SELECT is(pg_temp.as_user(2, 'SELECT public.grade_match(''e2410000-0000-4000-8000-000000000001'')::text'), '1', 'a dictator grades the prediction');
SELECT is((SELECT points_awarded FROM public.predictions WHERE match_id = 'e2410000-0000-4000-8000-000000000001'), 300,
  'a 0-0 prediction of a 0-0 match scores 300');
SELECT ok((SELECT graded_events_version IS NOT NULL AND status = 'graded' FROM public.predictions WHERE match_id = 'e2410000-0000-4000-8000-000000000001')
          AND (SELECT is_graded FROM public.matches WHERE id = 'e2410000-0000-4000-8000-000000000001'),
  'grading records the events version and marks the match graded');

SELECT * FROM finish();
ROLLBACK;

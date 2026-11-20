-- LOCAL rehearsal only: edge cases on top of the legacy seed (the schema before match events), then a "before" snapshot.
-- The seed's goals, assists and scores are consistent; this adds the awkward shapes real data holds.
BEGIN;
CREATE TEMP TABLE _pick ON COMMIT DROP AS
SELECT m.id, m.home_team_id, m.away_team_id, row_number() OVER (ORDER BY m.id) AS rn
FROM public.matches m WHERE m.status = 'completed' AND EXISTS (SELECT 1 FROM public.goals g WHERE g.match_id = m.id AND NOT g.is_own_goal AND g.player_id IS NOT NULL);

-- 1. A goal whose assister is the scorer, and an own goal that carries an assister (both assists are dropped and reported).
INSERT INTO public.goals (match_id, player_id, team_id, minute, assist_id, is_own_goal)
SELECT p.id, g.player_id, g.team_id, '40', g.player_id, false FROM _pick p JOIN LATERAL (SELECT * FROM public.goals WHERE match_id = p.id AND NOT is_own_goal AND player_id IS NOT NULL LIMIT 1) g ON true WHERE p.rn = 1;
INSERT INTO public.goals (match_id, player_id, team_id, minute, assist_id, is_own_goal)
SELECT p.id, g.player_id, g.team_id, '41', g.player_id, true FROM _pick p JOIN LATERAL (SELECT * FROM public.goals WHERE match_id = p.id AND NOT is_own_goal AND player_id IS NOT NULL LIMIT 1) g ON true WHERE p.rn = 1;
-- The extra goal and the own goal (both by the same side) credit one goal to each side: the recorded score follows.
UPDATE public.matches m SET home_score = COALESCE(m.home_score, 0) + 1, away_score = COALESCE(m.away_score, 0) + 1 FROM _pick p WHERE m.id = p.id AND p.rn = 1;

-- 2. A minute that is not a number.
UPDATE public.goals SET minute = 'ET' WHERE id = (SELECT g.id FROM public.goals g JOIN _pick p ON p.id = g.match_id WHERE p.rn = 2 AND NOT g.is_own_goal LIMIT 1);

-- 3. A completed match with a score and no goal rows at all: unattributed goals and a walkover candidate.
DELETE FROM public.goals WHERE match_id = (SELECT id FROM _pick WHERE rn = 3);
UPDATE public.matches SET scorers = '[]', assists = '[]', own_goals = '[]' WHERE id = (SELECT id FROM _pick WHERE rn = 3);

-- 4. A goal that exists only in the match JSON (its row is gone): it is recreated, attributed, from the JSON.
DELETE FROM public.goals WHERE id = (SELECT g.id FROM public.goals g JOIN _pick p ON p.id = g.match_id WHERE p.rn = 4 LIMIT 1);

-- Snapshot of what must survive.
CREATE TABLE public.rehearsal_before AS
SELECT m.id AS match_id, m.home_score, m.away_score, (SELECT count(*) FROM public.goals g WHERE g.match_id = m.id) AS goal_rows
FROM public.matches m;
CREATE TABLE public.rehearsal_before_points AS
SELECT COALESCE(sum(points_awarded), 0) AS total, count(*) FILTER (WHERE status = 'graded') AS graded FROM public.predictions;
COMMIT;

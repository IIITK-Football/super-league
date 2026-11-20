-- LOCAL rehearsal only: a match with more goal rows than its recorded score must stop the migration with nothing changed.
BEGIN;
INSERT INTO public.goals (match_id, player_id, team_id, minute, is_own_goal)
SELECT g.match_id, g.player_id, g.team_id, '88', false
FROM public.goals g JOIN public.matches m ON m.id = g.match_id
WHERE m.status = 'completed' AND NOT g.is_own_goal ORDER BY g.id LIMIT 1;
-- one more goal than the score allows
UPDATE public.matches SET home_score = 0, away_score = 0 WHERE id = (SELECT match_id FROM public.goals ORDER BY id LIMIT 1);
COMMIT;

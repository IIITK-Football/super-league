-- One-time correction of legacy league point totals, run on a project that has NOT yet applied
-- 20261123000000_season_rosters_and_fantasy (that migration replaces user_profiles.points and stops while any total
-- differs from the graded league predictions).
--
-- Why (found in the production rehearsal, 2026-11-19): every league grader ever deployed set user_profiles.points to
-- the sum of the user's predictions.points_awarded, so league totals were accurate. Around 13 June 2026, World Cup
-- group-stage points were added to user_profiles.points outside the application (the World Cup page showed that
-- column as the World Cup score until 9 June) and never removed. Those points are also counted, correctly, in
-- wc_leaderboard, so the affected accounts carry them twice. In the rehearsal: 84 accounts and 10,930 points, 83
-- differing by exactly their group-stage points and one by part of them (its group points were regraded later).
--
-- Target: public.user_profiles.points only, for accounts whose stored total differs from the sum of their
-- predictions.points_awarded. Each is set to that sum. Nothing else is read for writing; World Cup tables are untouched.
-- Safeguards:
-- * every listed excess must be positive and no larger than the account's World Cup group-stage points graded by
--   13 June 2026 (IST); otherwise it stops with nothing changed;
-- * inside the transaction the tables are locked and the list is checked again: if any total or graded sum changed
--   since the list was made, or a new difference appeared, it stops with nothing changed;
-- * a row is updated only if it still holds the listed old total.
-- Running it again changes nothing (the list is empty).
--
-- How to run (owner, production SQL Editor, after the manual export, immediately before approving the production
-- database job; docs/release.md):
-- 1. Preview: run it with the COMMIT line below changed to ROLLBACK. Nothing is written; the list is shown.
-- 2. Run it as is. The result is the list of corrections (account id, old total, new total, excess; no personal
--    data). Export it: it is the rollback record (UPDATE user_profiles SET points = old_points for those ids).
-- It is never run by CI or by the assistant against a hosted project.
DROP TABLE IF EXISTS pg_temp._league_points_corrections;
CREATE TEMP TABLE _league_points_corrections AS
SELECT u.id AS user_id,
       COALESCE(u.points, 0) AS old_points,
       COALESCE(l.graded, 0) AS new_points,
       COALESCE(u.points, 0) - COALESCE(l.graded, 0) AS excess,
       COALESCE(g.group_points, 0) AS group_points_by_13_june
FROM public.user_profiles u
LEFT JOIN (SELECT p.user_id, sum(COALESCE(p.points_awarded, 0)) AS graded FROM public.predictions p GROUP BY p.user_id) l
  ON l.user_id = u.id
LEFT JOIN (SELECT w.user_id, sum(COALESCE(w.points_awarded, 0)) AS group_points
           FROM public.wc_group_predictions w
           WHERE w.updated_at < timestamptz '2026-06-14 00:00:00+05:30'
           GROUP BY w.user_id) g
  ON g.user_id = u.id
WHERE COALESCE(u.points, 0) <> COALESCE(l.graded, 0);

BEGIN;
LOCK TABLE public.user_profiles, public.predictions IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  v_unexplained integer;
  v_now integer;
  v_listed integer;
  v_changed integer;
BEGIN
  SELECT count(*) INTO v_unexplained FROM _league_points_corrections WHERE excess <= 0 OR excess > group_points_by_13_june;
  IF v_unexplained > 0 THEN
    RAISE EXCEPTION 'League points reconciliation stopped: % account(s) differ in a way the World Cup group-stage addition does not explain. Nothing was changed.', v_unexplained;
  END IF;
  -- The list must still describe the database exactly.
  SELECT count(*) INTO v_listed FROM _league_points_corrections;
  SELECT count(*) INTO v_now FROM public.user_profiles u
  WHERE COALESCE(u.points, 0) <> COALESCE((SELECT sum(COALESCE(p.points_awarded, 0)) FROM public.predictions p WHERE p.user_id = u.id), 0);
  SELECT count(*) INTO v_changed FROM _league_points_corrections c
  JOIN public.user_profiles u ON u.id = c.user_id
  WHERE COALESCE(u.points, 0) <> c.old_points
     OR COALESCE((SELECT sum(COALESCE(p.points_awarded, 0)) FROM public.predictions p WHERE p.user_id = u.id), 0) <> c.new_points;
  IF v_now <> v_listed OR v_changed > 0 THEN
    RAISE EXCEPTION 'League points reconciliation stopped: the data changed since the list was made (% now differ, % listed, % changed). Nothing was changed; run it again.', v_now, v_listed, v_changed;
  END IF;
  RAISE NOTICE 'League points reconciliation: % account(s) corrected', v_listed;
END;
$$;

UPDATE public.user_profiles u
SET points = c.new_points
FROM _league_points_corrections c
WHERE u.id = c.user_id AND COALESCE(u.points, 0) = c.old_points;

COMMIT;

SELECT user_id, old_points, new_points, excess FROM _league_points_corrections ORDER BY user_id;

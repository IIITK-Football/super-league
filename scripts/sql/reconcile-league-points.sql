-- One-time correction of legacy league point totals, run on a project that has NOT yet applied
-- 20261123000000_season_rosters_and_fantasy (that migration replaces user_profiles.points and stops while any total
-- differs from the graded league predictions).
--
-- Why (found in the production rehearsal, 2026-11-19): every league grader ever deployed set user_profiles.points to
-- the sum of the user's predictions.points_awarded, so league totals were accurate. Around 13 June 2026, World Cup
-- group-stage points were added to user_profiles.points outside the application (the World Cup page showed that
-- column as the World Cup score until 9 June) and never removed. Those points are also counted, correctly, in
-- wc_leaderboard, so the affected accounts carry them twice. In the rehearsal: 84 accounts, 83 differing by exactly
-- their group-stage points and one by part of them (its group points were regraded later).
--
-- What it does, in one transaction: for each account whose stored total differs from its graded league predictions,
-- it requires the excess to be positive and no larger than the account's World Cup group-stage points graded by
-- 2026-06-13. If any account does not fit, it stops and changes nothing. Otherwise it sets the stored total to the
-- graded league predictions for exactly those accounts and lists each correction (account id, old total, new total,
-- excess; no personal data): export that result. World Cup tables are not touched. Running it again changes nothing.
--
-- Production: the owner runs this in the SQL Editor after the manual export and immediately before approving the
-- production database job (docs/release.md). It is never run by CI or by the assistant against a hosted project.
BEGIN;

CREATE TEMP TABLE _league_points_corrections ON COMMIT DROP AS
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

DO $$
DECLARE
  v_unexplained integer;
BEGIN
  SELECT count(*) INTO v_unexplained FROM _league_points_corrections
  WHERE excess <= 0 OR excess > group_points_by_13_june;
  IF v_unexplained > 0 THEN
    RAISE EXCEPTION 'League points reconciliation stopped: % account(s) differ in a way the World Cup group-stage addition does not explain. Nothing was changed.', v_unexplained;
  END IF;
  RAISE NOTICE 'League points reconciliation: % account(s) corrected', (SELECT count(*) FROM _league_points_corrections);
END;
$$;

UPDATE public.user_profiles u
SET points = c.new_points
FROM _league_points_corrections c
WHERE u.id = c.user_id;

SELECT user_id, old_points, new_points, excess FROM _league_points_corrections ORDER BY user_id;

COMMIT;

-- Season rosters and season fantasy points (owner instruction 2026-11-19: all division data belongs to a season).
--
-- * players.team_entry_id: a player is on a team's roster for one season (the team's entry in that season). Every
--   existing player joins its team's 2026 entry. Team identity (name, logo, colour) stays division-wide.
-- * public.season_fantasy_points: a user's fantasy points in a season are the sum of their graded predictions on
--   that season's matches (points_awarded, as grading wrote it). It replaces the cross-division total
--   user_profiles.points, which grading kept equal to the sum of points_awarded over all of a user's predictions.
--
-- Guards (nothing is changed unless all hold):
--   * a player's team has exactly one season entry, so the backfill is unambiguous;
--   * every real account's stored total equals the sum of its graded predictions (owner decision: stop and report
--     any difference rather than drop or move it). The synthetic seed accounts are not checked: their totals are
--     fixture numbers, not grading results.
-- Forward-only.

-- season-fantasy-guard:start
DO $$
DECLARE
  v_ambiguous integer;
  v_orphans integer;
  v_points integer;
BEGIN
  SELECT count(*) INTO v_ambiguous
  FROM public.players p
  WHERE p.team_id IS NOT NULL
    AND (SELECT count(*) FROM public.team_entries e WHERE e.team_id = p.team_id) <> 1;
  IF v_ambiguous > 0 THEN
    RAISE EXCEPTION 'Season roster stopped: % player(s) belong to a team without exactly one season entry. Nothing was changed.', v_ambiguous;
  END IF;

  SELECT count(*) INTO v_points
  FROM public.user_profiles u
  WHERE COALESCE(u.email, '') !~ '^(lamb|river|diana|sydney|fan[0-9]{2})@iiitkottayam\.ac\.in$'
    AND COALESCE(u.points, 0) <> COALESCE((SELECT sum(COALESCE(p.points_awarded, 0)) FROM public.predictions p
                                           WHERE p.user_id = u.id), 0);
  IF v_points > 0 THEN
    RAISE EXCEPTION 'Season fantasy stopped: % account(s) have a stored points total that differs from their graded predictions. Nothing was changed; resolve them first (docs/decisions/D-01-division-season-mapping.md).', v_points;
  END IF;

  SELECT count(*) INTO v_orphans FROM public.players WHERE team_id IS NULL;
  RAISE NOTICE 'season rosters: % player(s) without a team keep no season roster', v_orphans;
END $$;
-- season-fantasy-guard:end

ALTER TABLE public.players ADD COLUMN team_entry_id uuid REFERENCES public.team_entries(id) ON DELETE RESTRICT;
CREATE INDEX players_team_entry_id_idx ON public.players (team_entry_id);
COMMENT ON COLUMN public.players.team_entry_id IS 'The season roster this player is on (a team''s entry in one season).';

UPDATE public.players p
SET team_entry_id = e.id
FROM public.team_entries e
WHERE e.team_id = p.team_id AND p.team_entry_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.players WHERE team_id IS NOT NULL AND team_entry_id IS NULL) THEN
    RAISE EXCEPTION 'Season roster stopped: a player with a team was not placed on a season roster. Nothing was changed.';
  END IF;
END $$;

-- A user's fantasy points per season: the sum of their graded predictions on that season's matches.
CREATE VIEW public.season_fantasy_points WITH (security_invoker = true) AS
SELECT p.user_id,
       m.season_id,
       sum(COALESCE(p.points_awarded, 0))::integer AS points,
       count(*) FILTER (WHERE p.status = 'graded')::integer AS graded_predictions
FROM public.predictions p
JOIN public.matches m ON m.id = p.match_id
GROUP BY p.user_id, m.season_id;
COMMENT ON VIEW public.season_fantasy_points IS 'Fantasy points per user and season (replaces the cross-division total user_profiles.points).';

-- The leaderboard was public: everyone could read every profile's points total. Season points stay public through
-- this security-definer function, which exposes only the totals, never the predictions themselves.
CREATE FUNCTION public.season_fantasy_leaderboard(p_season uuid, p_limit integer DEFAULT 100)
RETURNS TABLE (user_id uuid, points integer, graded_predictions integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $$
  SELECT p.user_id, sum(COALESCE(p.points_awarded, 0))::integer, (count(*) FILTER (WHERE p.status = 'graded'))::integer
  FROM public.predictions p
  JOIN public.matches m ON m.id = p.match_id
  JOIN public.seasons s ON s.id = m.season_id
  WHERE m.season_id = p_season
    AND s.visibility = 'public' AND s.archived_at IS NULL
  GROUP BY p.user_id
  HAVING sum(COALESCE(p.points_awarded, 0)) > 0
  ORDER BY 2 DESC, p.user_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
$$;
REVOKE ALL ON FUNCTION public.season_fantasy_leaderboard(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.season_fantasy_leaderboard(uuid, integer) TO anon, authenticated, service_role;

ALTER TABLE public.user_profiles DROP COLUMN points;

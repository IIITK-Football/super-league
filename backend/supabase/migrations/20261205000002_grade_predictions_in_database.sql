-- Fantasy grading runs in the database (D-04: a write a person starts never uses the secret key; every multi-write is
-- one call). The grading routes used to read and update each prediction from the Worker with the secret key: one
-- Data API call per prediction and per match, which exceeds the Worker's subrequest limit for a busy match and for a
-- full regrade, and left the audit history without the dictator as actor.
--
-- The points are the same as backend/lib/grading.ts (which still computes the history breakdown; a test compares the
-- two): an exact scoreline 300; otherwise 100 for the right outcome minus 10 per goal of difference on each side; plus
-- 100 per predicted scorer and 50 per predicted assister who matches an attributed, non-voided goal event (each
-- player counts at most as often as they actually scored or assisted). Own goals and unattributed goals count toward
-- the scoreline only.

CREATE FUNCTION public.prediction_player_hits(p_predicted jsonb, p_actual uuid[])
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path TO ''
AS $$
  SELECT COALESCE(sum(LEAST(pc.n, ac.n)), 0)::integer
  FROM (
    SELECT x AS id, count(*) AS n
    FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_predicted) = 'array' THEN p_predicted ELSE '[]'::jsonb END) AS x
    GROUP BY x
  ) pc
  JOIN (SELECT y::text AS id, count(*) AS n FROM unnest(COALESCE(p_actual, '{}'::uuid[])) AS y GROUP BY y) ac ON ac.id = pc.id
$$;

CREATE FUNCTION public.prediction_points(
  p_pred_home integer, p_pred_away integer, p_scorers jsonb, p_assists jsonb,
  p_home integer, p_away integer, p_actual_scorers uuid[], p_actual_assists uuid[]
)
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path TO ''
AS $$
  SELECT
    CASE
      WHEN p_pred_home = COALESCE(p_home, 0) AND p_pred_away = COALESCE(p_away, 0) THEN 300
      ELSE
        (CASE WHEN sign(p_pred_home - p_pred_away) = sign(COALESCE(p_home, 0) - COALESCE(p_away, 0)) THEN 100 ELSE 0 END)
        - (abs(p_pred_home - COALESCE(p_home, 0)) + abs(p_pred_away - COALESCE(p_away, 0))) * 10
    END
    + public.prediction_player_hits(p_scorers, p_actual_scorers) * 100
    + public.prediction_player_hits(p_assists, p_actual_assists) * 50
$$;

-- Grades every prediction of one completed match from its events, as the dictator. Safe to repeat: points are
-- overwritten with the same values and graded_events_version records the events version graded. p_only_graded
-- regrades only predictions that were already graded. Returns the number of predictions graded.
CREATE FUNCTION public.grade_match(p_match uuid, p_only_graded boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  m record;
  v_scorers uuid[];
  v_assists uuid[];
  v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can grade predictions.' USING ERRCODE = '42501';
  END IF;
  SELECT id, home_score, away_score, status, events_version INTO m FROM public.matches WHERE id = p_match;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found.' USING ERRCODE = 'P0002';
  END IF;
  IF m.status <> 'completed' THEN
    RAISE EXCEPTION 'Match must be marked ''completed'' before grading.' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(e.player_id) FILTER (WHERE e.player_id IS NOT NULL),
         array_agg(e.assist_player_id) FILTER (WHERE e.assist_player_id IS NOT NULL)
    INTO v_scorers, v_assists
  FROM public.match_events e
  WHERE e.match_id = p_match AND e.kind = 'goal' AND e.voided_at IS NULL;

  UPDATE public.predictions p
  SET points_awarded = public.prediction_points(p.predicted_home_score, p.predicted_away_score, p.predicted_scorers, p.predicted_assists,
                                                m.home_score, m.away_score, v_scorers, v_assists),
      status = 'graded',
      graded_events_version = m.events_version
  WHERE p.match_id = p_match AND (NOT p_only_graded OR p.status = 'graded');
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.matches SET is_graded = true WHERE id = p_match;
  RETURN v_count;
END;
$$;

-- Regrades every completed match that already has graded predictions, in one transaction. Returns the number of
-- predictions regraded.
CREATE FUNCTION public.regrade_all_predictions()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_match uuid;
  v_total integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can regrade predictions.' USING ERRCODE = '42501';
  END IF;
  FOR v_match IN
    SELECT DISTINCT p.match_id FROM public.predictions p JOIN public.matches mt ON mt.id = p.match_id
    WHERE p.status = 'graded' AND mt.status = 'completed'
  LOOP
    v_total := v_total + public.grade_match(v_match, true);
  END LOOP;
  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.prediction_player_hits(jsonb, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prediction_points(integer, integer, jsonb, jsonb, integer, integer, uuid[], uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.grade_match(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.regrade_all_predictions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prediction_player_hits(jsonb, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prediction_points(integer, integer, jsonb, jsonb, integer, integer, uuid[], uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grade_match(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regrade_all_predictions() TO authenticated;

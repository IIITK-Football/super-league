-- Creating a match that is awarded (walkover or forfeit) is one transaction (D-04: every multi-write is one RPC).
-- The route used to insert the match, award it in a second call, and delete the match again if the award failed; a
-- failure between those calls could leave a half-made match. This function does both or neither.
--
-- SECURITY INVOKER: the insert runs under the caller's row level security (only a dictator manages matches), and
-- award_match_result checks the dictator again.

CREATE FUNCTION public.create_awarded_match(
  p_season uuid,
  p_home_team uuid,
  p_away_team uuid,
  p_date timestamptz,
  p_venue text,
  p_kind text,
  p_home integer,
  p_away integer,
  p_reason text
)
RETURNS SETOF public.matches
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can award a result' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.matches (home_team_id, away_team_id, date, venue, season_id, status)
  VALUES (p_home_team, p_away_team, p_date, p_venue, p_season, 'scheduled')
  RETURNING id INTO v_id;
  PERFORM public.award_match_result(v_id, p_kind, p_home, p_away, p_reason);
  RETURN QUERY SELECT * FROM public.matches WHERE id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_awarded_match(uuid, uuid, uuid, timestamptz, text, text, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_awarded_match(uuid, uuid, uuid, timestamptz, text, text, integer, integer, text) TO authenticated;

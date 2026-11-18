-- Make a season its division's current season in one step (used by the dictator dashboard).
--
-- At most one season per division is current (partial unique index seasons_one_current_per_division), so switching
-- needs two updates in one transaction: clear the old current season, then set the new one. The function runs with
-- the caller's rights (SECURITY INVOKER), so the seasons RLS policies still apply; it also refuses anyone who is not a
-- dictator with a clear message, and refuses an archived season. Legacy writers follow the current season
-- (public.legacy_current_season), so new legacy rows of that division attach to the new current season.
-- Forward-only.

CREATE FUNCTION public.set_current_season(p_season uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_division uuid;
  v_archived timestamptz;
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can change the current season' USING ERRCODE = '42501';
  END IF;

  SELECT division_id, archived_at INTO v_division, v_archived FROM public.seasons WHERE id = p_season;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Season not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'An archived season cannot be current; restore it first' USING ERRCODE = '22023';
  END IF;

  UPDATE public.seasons SET is_current = false WHERE division_id = v_division AND is_current AND id <> p_season;
  UPDATE public.seasons SET is_current = true WHERE id = p_season;
END;
$$;

REVOKE ALL ON FUNCTION public.set_current_season(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_current_season(uuid) TO authenticated, service_role;

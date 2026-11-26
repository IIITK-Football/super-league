-- Team details (name, short name, colour, logo) are changed by the captain of a writable team entry or by a dictator,
-- through these two functions and never with the server's secret key (D-04: a write a person starts never uses it).
-- The update therefore runs as the caller, so the audit history names them. Row level security still lets only
-- dictators update teams directly; these functions check the caller explicitly instead.
--
-- team_details_for_edit reads the shared team behind an entry, including entries of a hidden upcoming season that
-- the public policies do not show. captain_update_team_details writes it; a null name, short name or logo keeps the
-- current value, and the route validates formats before calling (the checks here repeat the limits).

CREATE FUNCTION public.team_details_for_edit(p_entry uuid)
RETURNS TABLE (team_id uuid, name text, short_name text, logo_url text, team_color text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_dictator() OR public.is_captain_of(p_entry)) THEN
    RAISE EXCEPTION 'Only the team''s captain or a dictator can change its details' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT t.id, t.name::text, t.short_name::text, t.logo_url::text, t.team_color::text
    FROM public.team_entries e JOIN public.teams t ON t.id = e.team_id
    WHERE e.id = p_entry;
END;
$$;

CREATE FUNCTION public.captain_update_team_details(
  p_entry uuid,
  p_name text,
  p_short_name text,
  p_color text,
  p_logo_url text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_team uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_dictator() OR public.is_captain_of(p_entry)) THEN
    RAISE EXCEPTION 'Only the team''s captain or a dictator can change its details' USING ERRCODE = '42501';
  END IF;
  SELECT e.team_id INTO v_team FROM public.team_entries e WHERE e.id = p_entry;
  IF v_team IS NULL THEN
    RAISE EXCEPTION 'Team entry not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_name IS NOT NULL AND char_length(btrim(p_name)) NOT BETWEEN 2 AND 60 THEN
    RAISE EXCEPTION 'The team name must be 2 to 60 characters' USING ERRCODE = '22023';
  END IF;
  IF p_short_name IS NOT NULL AND p_short_name <> '' AND p_short_name !~ '^[A-Z0-9]{2,5}$' THEN
    RAISE EXCEPTION 'The short name must be 2 to 5 letters or numbers' USING ERRCODE = '22023';
  END IF;
  IF p_color IS NULL OR p_color !~* '^#[0-9a-f]{6}$' THEN
    RAISE EXCEPTION 'Choose a valid team color' USING ERRCODE = '22023';
  END IF;

  UPDATE public.teams SET
    name = COALESCE(btrim(p_name), name),
    short_name = CASE WHEN p_short_name IS NULL THEN short_name ELSE NULLIF(p_short_name, '') END,
    team_color = p_color,
    logo_url = COALESCE(p_logo_url, logo_url)
  WHERE id = v_team;
END;
$$;

REVOKE ALL ON FUNCTION public.team_details_for_edit(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.captain_update_team_details(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_details_for_edit(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.captain_update_team_details(uuid, text, text, text, text) TO authenticated;

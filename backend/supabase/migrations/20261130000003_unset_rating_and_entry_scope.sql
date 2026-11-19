-- A player's overall rating stays unset until someone enters it, and captain writes are tied to the exact team entry.
-- * The rating column has no default (it was 0) and a new or changed rating must be 1..99 or NULL. The check is NOT
--   VALID: existing rows are not touched or rewritten; every new write is checked.
-- * create_rostered_player no longer falls back to 50; update_rostered_player can clear a rating (NULL);
--   captain_update_roster_player accepts NULL ("not set"). Nothing is ever filled in on anyone's behalf.
-- * captain_update_roster_player names the team entry: the roster place's team entry must be the one the caller's
--   registration (team and season) resolves to, for a captain in the current season; dictators keep full scope. The
--   shared card (rating, attributes, portrait) is written on the player; jersey and position on that place only.

ALTER TABLE public.players ALTER COLUMN overall_rating DROP DEFAULT;
ALTER TABLE public.players ADD CONSTRAINT players_overall_rating_range
  CHECK (overall_rating IS NULL OR overall_rating BETWEEN 1 AND 99) NOT VALID;

CREATE OR REPLACE FUNCTION public.create_rostered_player(
  p_team_entry_id uuid,
  p_first_name text,
  p_last_name text,
  p_jersey_number integer DEFAULT NULL,
  p_position text DEFAULT NULL,
  p_overall_rating integer DEFAULT NULL,
  p_attributes jsonb DEFAULT '{}'::jsonb,
  p_image_url text DEFAULT NULL,
  p_email text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_player uuid;
  v_season uuid;
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can create players' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_first_name, ''))) NOT BETWEEN 1 AND 100 OR char_length(btrim(COALESCE(p_last_name, ''))) > 100 THEN
    RAISE EXCEPTION 'A first name (up to 100 characters) is required' USING ERRCODE = '22023';
  END IF;
  SELECT season_id INTO v_season FROM public.team_entries WHERE id = p_team_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team entry not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.players (first_name, last_name, overall_rating, attributes, image_url)
  VALUES (btrim(p_first_name), btrim(COALESCE(p_last_name, '')), p_overall_rating, COALESCE(p_attributes, '{}'::jsonb), p_image_url)
  RETURNING id INTO v_player;
  INSERT INTO public.roster_memberships (player_id, team_entry_id, season_id, jersey_number, position)
  VALUES (v_player, p_team_entry_id, v_season, p_jersey_number, NULLIF(btrim(p_position), ''));
  IF NULLIF(btrim(p_email), '') IS NOT NULL THEN
    INSERT INTO public.player_private_details (player_id, email) VALUES (v_player, lower(btrim(p_email)));
  END IF;
  RETURN v_player;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_rostered_player(
  p_membership_id uuid,
  p_first_name text,
  p_last_name text,
  p_overall_rating integer,
  p_attributes jsonb,
  p_jersey_number integer,
  p_position text,
  p_set_email boolean DEFAULT false,
  p_email text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_player uuid;
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can edit players' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_first_name, ''))) NOT BETWEEN 1 AND 100 OR char_length(btrim(COALESCE(p_last_name, ''))) > 100 THEN
    RAISE EXCEPTION 'A first name (up to 100 characters) is required' USING ERRCODE = '22023';
  END IF;
  SELECT player_id INTO v_player FROM public.roster_memberships WHERE id = p_membership_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Roster place not found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.players
  SET first_name = btrim(p_first_name), last_name = btrim(COALESCE(p_last_name, '')),
      overall_rating = p_overall_rating, attributes = COALESCE(p_attributes, '{}'::jsonb)
  WHERE id = v_player;
  UPDATE public.roster_memberships SET jersey_number = p_jersey_number, position = NULLIF(btrim(p_position), '')
  WHERE id = p_membership_id;
  IF p_set_email THEN
    IF NULLIF(btrim(p_email), '') IS NULL THEN
      DELETE FROM public.player_private_details WHERE player_id = v_player;
    ELSE
      INSERT INTO public.player_private_details (player_id, email) VALUES (v_player, lower(btrim(p_email)))
      ON CONFLICT (player_id) DO UPDATE SET email = EXCLUDED.email;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.captain_update_roster_player(
  p_membership_id uuid,
  p_position text,
  p_jersey_number integer,
  p_overall_rating integer,
  p_attributes jsonb,
  p_image_url text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_dictator boolean;
  v_is_captain boolean;
  v_player uuid;
  v_entry uuid;
  v_current boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in';
  END IF;
  IF p_position IS NOT NULL AND p_position NOT IN
     ('GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'CF', 'ST') THEN
    RAISE EXCEPTION 'Choose a valid player position';
  END IF;
  IF p_jersey_number IS NOT NULL AND p_jersey_number NOT BETWEEN 0 AND 99 THEN
    RAISE EXCEPTION 'Jersey number must be between 0 and 99';
  END IF;
  -- Not set is allowed; a rating that is set must be 1..99. Nothing is filled in.
  IF p_overall_rating IS NOT NULL AND p_overall_rating NOT BETWEEN 1 AND 99 THEN
    RAISE EXCEPTION 'Overall rating must be between 1 and 99';
  END IF;
  IF jsonb_typeof(p_attributes) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Player attributes must be an object';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_uid AND ur.role = 'dictator'),
         EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_uid AND ur.role = 'captain')
  INTO v_is_dictator, v_is_captain;

  SELECT rm.player_id, rm.team_entry_id, s.is_current INTO v_player, v_entry, v_current
  FROM public.roster_memberships rm
  JOIN public.seasons s ON s.id = rm.season_id
  WHERE rm.id = p_membership_id;

  -- The roster place must be on the exact team entry of one of the caller's registrations (its team in its season).
  -- A missing place and someone else's place give the same error, so callers cannot discover which exist.
  IF NOT FOUND OR (NOT v_is_dictator AND NOT EXISTS (
       SELECT 1 FROM public.team_registrations r
       JOIN public.team_entries e ON e.team_id = r.team_id AND e.season_id = r.season_id
       WHERE r.captain_id = v_uid AND e.id = v_entry)) THEN
    RAISE EXCEPTION 'Player is not part of your assigned roster';
  END IF;
  IF NOT v_is_dictator AND NOT v_is_captain THEN
    RAISE EXCEPTION 'Captain access is required to update players';
  END IF;
  -- The card is shared by every season; a captain edits it only through the current season's roster.
  IF NOT v_is_dictator AND NOT v_current THEN
    RAISE EXCEPTION 'Only the current season''s roster can be edited by its captain';
  END IF;

  BEGIN
    UPDATE public.roster_memberships SET position = p_position, jersey_number = p_jersey_number WHERE id = p_membership_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Jersey number % is already taken on this team', p_jersey_number;
  END;
  UPDATE public.players
  SET overall_rating = p_overall_rating, attributes = p_attributes, image_url = p_image_url
  WHERE id = v_player;
END;
$$;

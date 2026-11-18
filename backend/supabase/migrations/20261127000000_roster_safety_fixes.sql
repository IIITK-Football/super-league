-- Roster safety fixes after review (forward-only; 20261124000000 and 20261125000000 are already applied on staging).
--
-- * captain_update_roster_player: a captain may edit only a roster place in a CURRENT season. The card fields it
--   writes (rating, attributes, portrait) belong to the player's shared identity, so a captain's assignment from an
--   earlier season must not reach a player who has since moved on. Jersey numbers 0-99 (as the table allows).
-- * create_team_in_season / delete_unplayed_player: the dictator's two multi-write actions become single transactions,
--   so a refused second write can no longer leave an orphan team or a player removed from a roster but not deleted.
-- * roster_memberships_keep_history also refuses moving a roster place with statistics to another player or season.

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
  v_team uuid;
  v_season uuid;
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
  IF p_overall_rating IS NULL OR p_overall_rating NOT BETWEEN 1 AND 99 THEN
    RAISE EXCEPTION 'Overall rating must be between 1 and 99';
  END IF;
  IF jsonb_typeof(p_attributes) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Player attributes must be an object';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_uid AND ur.role = 'dictator'),
         EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_uid AND ur.role = 'captain')
  INTO v_is_dictator, v_is_captain;

  SELECT rm.player_id, te.team_id, rm.season_id, s.is_current INTO v_player, v_team, v_season, v_current
  FROM public.roster_memberships rm
  JOIN public.team_entries te ON te.id = rm.team_entry_id
  JOIN public.seasons s ON s.id = rm.season_id
  WHERE rm.id = p_membership_id;

  -- A missing player and someone else's player give the same error, so callers cannot discover which exist.
  IF NOT FOUND OR (NOT v_is_dictator AND NOT EXISTS (
       SELECT 1 FROM public.team_registrations r
       WHERE r.captain_id = v_uid AND r.team_id = v_team AND r.season_id = v_season)) THEN
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

-- A dictator adds a new team to a season in one step (the team and its season entry together).
-- search_path is 'public' (not empty) because the existing teams trigger enforce_team_logo_and_color uses unqualified
-- names; this function runs with the caller's rights, so the search path grants nothing.
CREATE FUNCTION public.create_team_in_season(p_season_id uuid, p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_name text := btrim(COALESCE(p_name, ''));
  v_team uuid;
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can add teams to a season' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_name) NOT BETWEEN 2 AND 60 THEN
    RAISE EXCEPTION 'A team name needs 2 to 60 characters' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.seasons WHERE id = p_season_id) THEN
    RAISE EXCEPTION 'Season not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.teams (name, short_name)
  VALUES (v_name, NULLIF(upper(left(regexp_replace(v_name, '[^a-zA-Z0-9]', '', 'g'), 4)), ''))
  RETURNING id INTO v_team;
  INSERT INTO public.team_entries (team_id, season_id) VALUES (v_team, p_season_id);
  RETURN v_team;
END;
$$;
REVOKE ALL ON FUNCTION public.create_team_in_season(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_team_in_season(uuid, text) TO authenticated, service_role;

-- A dictator deletes a player who never played: no other roster place, no goal or assist (own goals included),
-- no statistics. The roster place and the player go together, or nothing changes.
CREATE FUNCTION public.delete_unplayed_player(p_player_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can delete players' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = p_player_id) THEN
    RAISE EXCEPTION 'Player not found' USING ERRCODE = 'P0002';
  END IF;
  IF (SELECT count(*) FROM public.roster_memberships WHERE player_id = p_player_id) > 1 THEN
    RAISE EXCEPTION 'This player plays in another season, so the player is kept' USING ERRCODE = '23503';
  END IF;
  IF EXISTS (SELECT 1 FROM public.goals WHERE player_id = p_player_id OR assist_id = p_player_id)
     OR EXISTS (SELECT 1 FROM public.season_player_stats WHERE player_id = p_player_id) THEN
    RAISE EXCEPTION 'This player has match history, so the player is kept' USING ERRCODE = '23503';
  END IF;
  DELETE FROM public.roster_memberships WHERE player_id = p_player_id;
  DELETE FROM public.players WHERE id = p_player_id;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_unplayed_player(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_unplayed_player(uuid) TO authenticated, service_role;

-- A roster place with statistics in its season is history: it cannot be removed, or moved to another player or
-- season. Moving to another team in the same season stays allowed.
CREATE OR REPLACE FUNCTION public.roster_memberships_keep_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.player_id = OLD.player_id AND NEW.season_id = OLD.season_id THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.season_player_stats s
             WHERE s.player_id = OLD.player_id AND s.season_id = OLD.season_id AND (s.goals > 0 OR s.assists > 0)) THEN
    RAISE EXCEPTION 'This player has goals or assists this season, so their place on the roster is kept'
      USING ERRCODE = '23503';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
DROP TRIGGER roster_memberships_keep_history ON public.roster_memberships;
CREATE TRIGGER roster_memberships_keep_history BEFORE UPDATE OR DELETE ON public.roster_memberships
  FOR EACH ROW EXECUTE FUNCTION public.roster_memberships_keep_history();

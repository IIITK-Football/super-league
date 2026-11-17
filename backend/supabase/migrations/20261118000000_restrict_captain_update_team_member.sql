-- Restrict the 7-argument captain_update_team_member RPC.
--
-- Until now it ran as its owner, checked nothing about the caller, had no pinned search_path, and was
-- executable by anon and PUBLIC. Anyone holding the publishable key could overwrite any registration
-- member's position, jersey number, rating, attributes, email and portrait.
--
-- After this migration:
--   * anon and PUBLIC cannot execute either overload (signed-in users and service_role still can);
--   * the caller must be the captain of the team entry that owns the player, or a dictator
--     (legacy "admin", editor and normal users get nothing: no role implies another);
--   * captains may change only the approved presentation fields (position, jersey number, overall rating,
--     attributes including the play style, and the card portrait); the email is a protected identity field,
--     so a captain who supplies a DIFFERENT email is refused (the stored value, or NULL, means "no change");
--   * the search_path is pinned and every object is schema-qualified.
--
-- This migration is forward-only. Do not restore the previous definition: it reopens the exposure.

CREATE OR REPLACE FUNCTION public.captain_update_team_member(
  p_member_id uuid,
  p_position text,
  p_jersey_number integer,
  p_overall_rating integer,
  p_attributes jsonb,
  p_email text,
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
  v_current_email text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in';
  END IF;

  -- Same validation as the 5-argument overload; an empty position or jersey number is allowed
  -- because the team builder saves partially filled players.
  IF p_position IS NOT NULL AND p_position NOT IN
     ('GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'CF', 'ST') THEN
    RAISE EXCEPTION 'Choose a valid player position';
  END IF;
  IF p_jersey_number IS NOT NULL AND p_jersey_number NOT BETWEEN 1 AND 99 THEN
    RAISE EXCEPTION 'Jersey number must be between 1 and 99';
  END IF;
  IF p_overall_rating IS NULL OR p_overall_rating NOT BETWEEN 1 AND 99 THEN
    RAISE EXCEPTION 'Overall rating must be between 1 and 99';
  END IF;
  IF jsonb_typeof(p_attributes) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Player attributes must be an object';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_uid AND ur.role = 'dictator'
  ) INTO v_is_dictator;

  -- The player must belong to the caller's own team entry (or the caller is a dictator). A missing player and
  -- someone else's player give the same error, so callers cannot discover which players exist.
  SELECT m.email INTO v_current_email
  FROM public.team_members m
  JOIN public.team_registrations r ON r.id = m.registration_id
  WHERE m.id = p_member_id
    AND (r.captain_id = v_uid OR v_is_dictator);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player is not part of your assigned roster';
  END IF;

  IF p_email IS NOT NULL AND p_email IS DISTINCT FROM v_current_email AND NOT v_is_dictator THEN
    RAISE EXCEPTION 'Only a dictator can change a player''s email';
  END IF;

  UPDATE public.team_members
  SET position = p_position,
      jersey_number = p_jersey_number,
      overall_rating = p_overall_rating,
      attributes = p_attributes,
      email = COALESCE(p_email, email),
      image_url = p_image_url
  WHERE id = p_member_id;
END;
$$;

ALTER FUNCTION public.captain_update_team_member(uuid, text, integer, integer, jsonb, text, text) OWNER TO postgres;

-- Signed-in users and the server may call both overloads; anonymous callers and PUBLIC may not.
REVOKE EXECUTE ON FUNCTION public.captain_update_team_member(uuid, text, integer, integer, jsonb, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.captain_update_team_member(uuid, text, integer, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.captain_update_team_member(uuid, text, integer, integer, jsonb, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.captain_update_team_member(uuid, text, integer, integer, jsonb) TO authenticated, service_role;

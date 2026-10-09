-- Update captain_update_team_member RPC to accept p_email and p_image_url
CREATE OR REPLACE FUNCTION public.captain_update_team_member(
  p_member_id UUID,
  p_position TEXT,
  p_jersey_number INTEGER,
  p_overall_rating INTEGER,
  p_attributes JSONB,
  p_email TEXT DEFAULT NULL,
  p_image_url TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF p_position IS NULL OR p_position NOT IN ('GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'CF', 'ST') THEN
    RAISE EXCEPTION 'Choose a valid player position';
  END IF;
  IF p_jersey_number IS NOT NULL AND p_jersey_number NOT BETWEEN 1 AND 99 THEN
    RAISE EXCEPTION 'Jersey number must be between 1 and 99';
  END IF;
  IF p_overall_rating NOT BETWEEN 1 AND 99 THEN
    RAISE EXCEPTION 'Overall rating must be between 1 and 99';
  END IF;
  IF jsonb_typeof(p_attributes) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Player attributes must be an object';
  END IF;

  UPDATE public.team_members AS member
  SET position = p_position,
      jersey_number = p_jersey_number,
      overall_rating = p_overall_rating,
      attributes = p_attributes,
      email = COALESCE(p_email, member.email),
      image_url = COALESCE(p_image_url, member.image_url)
  FROM public.team_registrations AS registration
  WHERE member.id = p_member_id
    AND registration.id = member.registration_id
    AND registration.captain_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player is not part of your assigned roster';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.captain_update_team_member(UUID, TEXT, INTEGER, INTEGER, JSONB, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.captain_update_team_member(UUID, TEXT, INTEGER, INTEGER, JSONB, TEXT, TEXT) TO authenticated;

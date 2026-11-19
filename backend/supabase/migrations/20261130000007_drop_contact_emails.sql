-- Contract step of the account-email change (20261130000006): every caller now reads the Auth email through
-- player_link_status and my_player, creates players through create_player_for_account and adds roster places through
-- add_player_to_roster. The emptied contact-email table, the account-less creator, the email arguments of the
-- dictator edit, the CSV import and the name-or-email account search are removed. Nothing here holds data: the
-- contact rows were reduced to outcomes (no addresses) and private match keys by 20261130000006, which aborts on any
-- loss; this migration also stops if a contact row reappeared.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.player_private_details) THEN
    RAISE EXCEPTION 'player_private_details has rows again; convert them before dropping the table (nothing was changed)';
  END IF;
END;
$$;

DROP TABLE public.player_private_details;
DROP FUNCTION public.create_rostered_player(uuid, text, text, integer, text, integer, jsonb, text, text);
DROP FUNCTION public.preview_player_account_links(jsonb);
DROP FUNCTION public.apply_player_account_links(jsonb);
DROP FUNCTION public.player_link_candidates(text);
DROP FUNCTION public.update_rostered_player(uuid, text, text, integer, jsonb, integer, text, boolean, text);

-- The dictator's edit of a player's card and roster place (no email: it comes from the linked account).
CREATE FUNCTION public.update_rostered_player(
  p_membership_id uuid,
  p_first_name text,
  p_last_name text,
  p_overall_rating integer,
  p_attributes jsonb,
  p_jersey_number integer,
  p_position text
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
END;
$$;
REVOKE ALL ON FUNCTION public.update_rostered_player(uuid, text, text, integer, jsonb, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_rostered_player(uuid, text, text, integer, jsonb, integer, text) TO authenticated;

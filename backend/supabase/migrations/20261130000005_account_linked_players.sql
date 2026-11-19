-- Account-linked players. A player identity (the reusable FUT card) can be linked to one verified Auth account, and an
-- account to at most one player. Only a dictator links or unlinks, on every path: direct Data API writes, roster and
-- self-service functions, and the server key are all refused by a trigger. Nobody but the server can read the link
-- (public pages read the card, never who it belongs to). Unlinking clears only the link; deleting an account keeps its
-- player. A linked player edits only their own portrait and preferred foot (owner decision 2026-11-19); a new
-- portrait goes live at once and, like every change here, is recorded in the audit history (players are audited).

ALTER TABLE public.players
  ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT players_user_id_key UNIQUE (user_id);

-- The link changes only by a dictator, only to a verified account. Sessions without a request JWT (migrations, the seed)
-- may set it; the account-deletion cascade may clear it.
CREATE FUNCTION public.players_account_link_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.user_id IS NULL THEN RETURN NEW; END IF;
  -- The account was deleted: ON DELETE SET NULL clears the link and keeps the player.
  IF TG_OP = 'UPDATE' AND NEW.user_id IS NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.user_id) THEN
    RETURN NEW;
  END IF;
  IF NULLIF(current_setting('request.jwt.claims', true), '') IS NOT NULL AND NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can link a player to an account' USING ERRCODE = '42501';
  END IF;
  IF NEW.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.user_id AND u.email_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Only a verified account can be linked to a player' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER players_account_link_guard BEFORE INSERT OR UPDATE OF user_id ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.players_account_link_guard();

-- Nobody but the server reads the link; signed-in writes (still gated by row level security) cannot name it.
REVOKE SELECT, INSERT, UPDATE ON public.players FROM anon, authenticated;
GRANT SELECT (id, first_name, last_name, image_url, overall_rating, attributes, created_at, updated_at) ON public.players TO anon, authenticated;
GRANT INSERT (first_name, last_name, image_url, overall_rating, attributes), UPDATE (first_name, last_name, image_url, overall_rating, attributes)
  ON public.players TO authenticated;

-- An account's label, as in account_directory: the verified sign-in email with the profile name as context.
CREATE FUNCTION public.account_label(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT CASE WHEN name IS NOT NULL AND email IS NOT NULL THEN name || ' (' || email || ')' ELSE COALESCE(email, name) END
  FROM (
    SELECT NULLIF(btrim(u.email::text), '') AS email,
           COALESCE(NULLIF(regexp_replace(p.real_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
                    NULLIF(regexp_replace(p.nickname, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '')) AS name
    FROM auth.users u LEFT JOIN public.user_profiles p ON p.id = u.id
    WHERE u.id = p_user
  ) x;
$$;
REVOKE ALL ON FUNCTION public.account_label(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.link_player_account(p_player uuid, p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can link a player to an account' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = p_player) THEN
    RAISE EXCEPTION 'Player not found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.players WHERE id = p_player AND user_id IS NOT NULL AND user_id <> p_user) THEN
    RAISE EXCEPTION 'This player is already linked to another account; unlink it first' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.players WHERE user_id = p_user AND id <> p_player) THEN
    RAISE EXCEPTION 'That account is already linked to another player' USING ERRCODE = '23505';
  END IF;
  UPDATE public.players SET user_id = p_user WHERE id = p_player;
END;
$$;

CREATE FUNCTION public.unlink_player_account(p_player uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can unlink a player from an account' USING ERRCODE = '42501';
  END IF;
  UPDATE public.players SET user_id = NULL WHERE id = p_player;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- Verified accounts to link, found by every word of the name or email, with the player each is already linked to.
CREATE FUNCTION public.player_link_candidates(p_query text)
RETURNS TABLE (user_id uuid, label text, linked_player_id uuid, linked_player_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  WITH words AS (
    SELECT array_agg('%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%') AS pats
    FROM regexp_split_to_table(btrim(coalesce(p_query, '')), '[[:space:]]+') AS w
    WHERE w <> ''
  )
  SELECT u.id, public.account_label(u.id), pl.id, NULLIF(btrim(pl.first_name || ' ' || pl.last_name), '')
  FROM auth.users u
  LEFT JOIN public.user_profiles p ON p.id = u.id
  LEFT JOIN public.players pl ON pl.user_id = u.id
  CROSS JOIN words
  WHERE public.is_dictator()
    AND u.email_confirmed_at IS NOT NULL
    AND char_length(btrim(coalesce(p_query, ''))) >= 2
    AND NOT EXISTS (SELECT 1 FROM unnest(words.pats) AS pat
                    WHERE concat_ws(' ', u.email::text, p.real_name, p.nickname) NOT ILIKE pat)
  ORDER BY 2, 1
  LIMIT 20;
$$;

-- Link status of the given players: whether each is linked, and to which account (by label).
CREATE FUNCTION public.player_link_status(p_player_ids uuid[])
RETURNS TABLE (player_id uuid, linked boolean, account_label text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT p.id, p.user_id IS NOT NULL, CASE WHEN p.user_id IS NULL THEN NULL ELSE public.account_label(p.user_id) END
  FROM public.players p
  WHERE public.is_dictator() AND p.id = ANY (p_player_ids);
$$;

-- The account-link import, read-only: one status per row of [{player_id, email}] (at most 500). Emails match verified
-- Auth accounts only (case and surrounding spaces ignored); a blank email uses the player's dictator-entered contact
-- email. Nothing is ever matched by name.
CREATE FUNCTION public.preview_player_account_links(p_rows jsonb)
RETURNS TABLE (n integer, player_id uuid, email text, status text, account_label text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can import account links' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'Send a list of at most 500 rows' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH raw AS (
    SELECT r.ord::integer AS n,
           CASE WHEN (r.row ->> 'player_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN (r.row ->> 'player_id')::uuid END AS player_id,
           r.row ->> 'player_id' AS player_text,
           lower(NULLIF(btrim(r.row ->> 'email'), '')) AS file_email
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS r(row, ord)
  ), resolved AS (
    SELECT raw.*, pl.id AS known_player, pl.user_id AS current_user_id,
           COALESCE(raw.file_email, lower(NULLIF(btrim(d.email), ''))) AS use_email
    FROM raw
    LEFT JOIN public.players pl ON pl.id = raw.player_id
    LEFT JOIN public.player_private_details d ON d.player_id = raw.player_id
  ), matched AS (
    SELECT resolved.*, u.id AS account_id, u.email_confirmed_at IS NOT NULL AS verified,
           (SELECT o.id FROM public.players o WHERE o.user_id = u.id) AS account_player,
           count(*) OVER (PARTITION BY resolved.player_id) AS player_rows,
           count(*) OVER (PARTITION BY resolved.use_email) AS email_rows
    FROM resolved
    LEFT JOIN auth.users u ON lower(u.email::text) = resolved.use_email
  )
  SELECT m.n, m.player_id, m.use_email,
         CASE
           WHEN m.player_text IS NULL OR m.player_id IS NULL THEN 'invalid_row'
           WHEN m.known_player IS NULL THEN 'unknown_player'
           WHEN m.use_email IS NULL THEN 'missing_email'
           WHEN m.player_rows > 1 THEN 'duplicate_player_in_file'
           WHEN m.email_rows > 1 THEN 'duplicate_account_in_file'
           WHEN m.account_id IS NULL THEN 'no_account'
           WHEN NOT m.verified THEN 'unverified_account'
           WHEN m.current_user_id = m.account_id THEN 'already_linked'
           WHEN m.current_user_id IS NOT NULL THEN 'player_linked_elsewhere'
           WHEN m.account_player IS NOT NULL THEN 'account_linked_elsewhere'
           ELSE 'ready'
         END,
         CASE WHEN m.account_id IS NULL THEN NULL ELSE public.account_label(m.account_id) END
  FROM matched m
  ORDER BY m.n;
END;
$$;

-- Applies the import: recomputes the preview and links every ready row, or changes nothing if any row has a problem.
-- Returns how many links were added (already-linked rows count as nothing to do).
CREATE FUNCTION public.apply_player_account_links(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  problems integer;
  added integer := 0;
  r record;
BEGIN
  SELECT count(*) INTO problems FROM public.preview_player_account_links(p_rows) WHERE status NOT IN ('ready', 'already_linked');
  IF problems > 0 THEN
    RAISE EXCEPTION '% row(s) need attention; nothing was linked. Preview the file to see why.', problems;
  END IF;
  FOR r IN SELECT p.player_id, u.id AS account_id
           FROM public.preview_player_account_links(p_rows) p JOIN auth.users u ON lower(u.email::text) = p.email
           WHERE p.status = 'ready' LOOP
    UPDATE public.players SET user_id = r.account_id WHERE id = r.player_id;
    added := added + 1;
  END LOOP;
  RETURN added;
END;
$$;

-- The signed-in user's own player: the card, their contact email and their roster places. NULL when not linked.
CREATE FUNCTION public.my_player()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'first_name', p.first_name, 'last_name', p.last_name, 'image_url', p.image_url,
    'overall_rating', p.overall_rating, 'attributes', p.attributes,
    'email', (SELECT d.email FROM public.player_private_details d WHERE d.player_id = p.id),
    'seasons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('season', s.name, 'division', dv.name, 'team', t.name,
                                          'jersey_number', m.jersey_number, 'position', m.position, 'is_current', s.is_current)
                       ORDER BY s.starts_on DESC NULLS LAST, s.sort_order DESC)
      FROM public.roster_memberships m
      JOIN public.seasons s ON s.id = m.season_id
      JOIN public.divisions dv ON dv.id = s.division_id
      JOIN public.team_entries e ON e.id = m.team_entry_id
      JOIN public.teams t ON t.id = e.team_id
      WHERE m.player_id = p.id), '[]'::jsonb))
  FROM public.players p
  WHERE p.user_id = auth.uid();
$$;

-- A linked player changes only their own portrait (their own stored picture, or none) and preferred foot.
CREATE FUNCTION public.update_my_player(p_image_url text, p_preferred_foot text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  me public.players%ROWTYPE;
  foot text := NULLIF(btrim(coalesce(p_preferred_foot, '')), '');
  bio jsonb;
BEGIN
  SELECT * INTO me FROM public.players WHERE user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No player is linked to your account' USING ERRCODE = '42501';
  END IF;
  IF p_image_url IS NOT NULL AND p_image_url IS DISTINCT FROM me.image_url
     AND p_image_url !~ ('^https?://[^[:space:]]+/players/' || me.id::text || '\.png$') THEN
    RAISE EXCEPTION 'Use a portrait uploaded for your own player' USING ERRCODE = '22023';
  END IF;
  IF foot IS NOT NULL AND foot NOT IN ('Right', 'Left', 'Both') THEN
    RAISE EXCEPTION 'Preferred foot must be Right, Left or Both' USING ERRCODE = '22023';
  END IF;
  bio := COALESCE(me.attributes -> 'bio', '{}'::jsonb) - 'preferredFoot';
  IF foot IS NOT NULL THEN bio := bio || jsonb_build_object('preferredFoot', foot); END IF;
  UPDATE public.players
  SET image_url = p_image_url,
      attributes = CASE WHEN bio = '{}'::jsonb THEN COALESCE(me.attributes, '{}'::jsonb) - 'bio'
                        ELSE jsonb_set(COALESCE(me.attributes, '{}'::jsonb), '{bio}', bio) END
  WHERE id = me.id;
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['link_player_account(uuid, uuid)', 'unlink_player_account(uuid)', 'player_link_candidates(text)',
                           'player_link_status(uuid[])', 'preview_player_account_links(jsonb)', 'apply_player_account_links(jsonb)',
                           'my_player()', 'update_my_player(text, text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.players_account_link_guard() FROM PUBLIC, anon, authenticated;

-- Search for the dictator dashboard. Each word of the query must match (case-insensitive, LIKE wildcards in the query
-- are taken literally), so "ada striker" finds Ada Striker. Results never carry an editable profile email or a raw id
-- as a label.

-- Accounts, for role management and captain assignment: labelled by the verified sign-in email from Supabase Auth
-- (never the self-editable profile email) with the profile's real name, else nickname, as context. p_ids looks up
-- given accounts (to label a current selection). Dictators only: anyone else gets no rows.
CREATE FUNCTION public.account_directory(p_query text DEFAULT NULL, p_ids uuid[] DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS TABLE (user_id uuid, label text, role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  WITH words AS (
    SELECT coalesce(array_agg('%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%'), '{}') AS pats
    FROM regexp_split_to_table(btrim(coalesce(p_query, '')), '[[:space:]]+') AS w
    WHERE w <> ''
  ), people AS (
    SELECT u.id,
           NULLIF(btrim(u.email::text), '') AS email,
           COALESCE(NULLIF(regexp_replace(p.real_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
                    NULLIF(regexp_replace(p.nickname, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '')) AS name,
           COALESCE(r.role, 'default') AS role
    FROM auth.users u
    LEFT JOIN public.user_profiles p ON p.id = u.id
    LEFT JOIN public.user_roles r ON r.user_id = u.id
    CROSS JOIN words
    WHERE public.is_dictator()
      AND (p_ids IS NULL OR u.id = ANY (p_ids))
      AND NOT EXISTS (SELECT 1 FROM unnest(words.pats) AS pat
                      WHERE concat_ws(' ', u.email::text, p.real_name, p.nickname) NOT ILIKE pat)
  )
  SELECT id,
         CASE WHEN name IS NOT NULL AND email IS NOT NULL THEN name || ' (' || email || ')'
              ELSE COALESCE(email, name, 'Account without an email') END,
         role
  FROM people
  ORDER BY 2, 1
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
$$;
REVOKE ALL ON FUNCTION public.account_directory(text, uuid[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_directory(text, uuid[], integer) TO authenticated, service_role;

-- Players (reusable identities), for adding an existing player to a season roster. Each result carries the player's
-- latest roster place (team, season, division, jersey) so players with the same name can be told apart, and whether
-- they already have a place in p_season_id (a player has at most one place per season). Security invoker: the
-- caller's row level security applies. A query shorter than two characters returns nothing.
CREATE FUNCTION public.search_players(p_query text, p_season_id uuid DEFAULT NULL, p_limit integer DEFAULT 20)
RETURNS TABLE (player_id uuid, first_name text, last_name text, image_url text, overall_rating integer, in_season boolean,
               last_team text, last_season text, last_division text, last_jersey integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  WITH words AS (
    SELECT array_agg('%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%') AS pats
    FROM regexp_split_to_table(btrim(coalesce(p_query, '')), '[[:space:]]+') AS w
    WHERE w <> ''
  )
  SELECT p.id, p.first_name::text, p.last_name::text, p.image_url::text, p.overall_rating::integer,
         EXISTS (SELECT 1 FROM public.roster_memberships m WHERE m.player_id = p.id AND m.season_id = p_season_id),
         latest.team, latest.season, latest.division, latest.jersey
  FROM public.players p
  CROSS JOIN words
  LEFT JOIN LATERAL (
    SELECT t.name::text AS team, s.name::text AS season, d.name::text AS division, m.jersey_number::integer AS jersey
    FROM public.roster_memberships m
    JOIN public.seasons s ON s.id = m.season_id
    JOIN public.divisions d ON d.id = s.division_id
    JOIN public.team_entries e ON e.id = m.team_entry_id
    JOIN public.teams t ON t.id = e.team_id
    WHERE m.player_id = p.id
    ORDER BY s.starts_on DESC NULLS LAST, s.sort_order DESC, s.created_at DESC
    LIMIT 1
  ) latest ON true
  WHERE char_length(btrim(coalesce(p_query, ''))) >= 2
    AND NOT EXISTS (SELECT 1 FROM unnest(words.pats) AS pat
                    WHERE concat_ws(' ', p.first_name, p.last_name) NOT ILIKE pat)
  ORDER BY p.last_name, p.first_name, p.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
$$;
REVOKE ALL ON FUNCTION public.search_players(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_players(text, uuid, integer) TO authenticated, service_role;

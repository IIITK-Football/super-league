-- Verified-email matching, automatic linking and account-first players (owner decisions 2026-11-19).
--
-- * Auth is the only source of a player's email: a linked player's email is the linked account's Auth email, an
--   unlinked player has none. The dictator-entered contact emails (player_private_details) are reduced here to
--   - player_email_migration_outcomes: one outcome per former contact row, with NO email address (evidence only);
--   - player_link_keys: the normalized email of each UNLINKED player, private, used only to match a verified account,
--     and deleted when the player is linked or the key is dismissed.
--   The contact rows are then removed; 20261130000007 drops the table once every caller is ported.
-- * Matching is exact on lower(btrim(email)), never by name. A dictator previews the matches and applies the safe ones
--   (account_link_matches, apply_account_link_matches), or links by hand (verified_accounts_for_linking,
--   link_player_account).
-- * When an account's email becomes verified, it is linked automatically to the one unlinked player whose key equals
--   it (auto_link_verified_account, from triggers on auth.users). No match or several: nothing happens, and the case
--   shows in the preview. A linking problem never blocks registration or confirmation.
-- * Every new player identity needs a verified account (create_player_for_account), and every new roster place needs a
--   linked player (add_player_to_roster). Sessions without a request JWT (migrations, the seed) are exempt.

-- Evidence and keys ------------------------------------------------------------------------------------------------

CREATE TABLE public.player_email_migration_outcomes (
  player_id uuid NOT NULL,
  outcome text NOT NULL CONSTRAINT player_email_migration_outcome_kind
    CHECK (outcome IN ('linked_auth_email_same', 'linked_auth_email_differs', 'unlinked_key_kept', 'discarded_blank_or_invalid')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.player_email_migration_outcomes IS
  'What happened to each former player contact email (20261130000006). Holds no email address. Dictators read; nobody writes.';
ALTER TABLE public.player_email_migration_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dictators read the email migration outcomes" ON public.player_email_migration_outcomes
  FOR SELECT TO authenticated USING (public.is_dictator());
REVOKE ALL ON public.player_email_migration_outcomes FROM anon, authenticated;
GRANT SELECT ON public.player_email_migration_outcomes TO authenticated;

CREATE TABLE public.player_link_keys (
  player_id uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  email text NOT NULL CONSTRAINT player_link_keys_normalized
    CHECK (email = lower(btrim(email)) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' AND char_length(email) <= 320),
  source text NOT NULL DEFAULT 'legacy_contact' CONSTRAINT player_link_keys_source CHECK (source IN ('legacy_contact')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX player_link_keys_email_idx ON public.player_link_keys (email);
COMMENT ON TABLE public.player_link_keys IS
  'The email an UNLINKED legacy player is expected to sign up with. Private: read only through dictator functions, never shown as a contact email; deleted on link or dismissal.';
ALTER TABLE public.player_link_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.player_link_keys FROM anon, authenticated;
-- History of keys (dismissals, removals on link) without the address.
CREATE TRIGGER audit_player_link_keys AFTER INSERT OR UPDATE OR DELETE ON public.player_link_keys
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('player_id', 'email');

-- The one-time conversion, guarded: one outcome per contact row, or nothing changes.
DO $$
DECLARE
  v_rows integer;
  v_outcomes integer;
BEGIN
  SELECT count(*) INTO v_rows FROM public.player_private_details;
  INSERT INTO public.player_email_migration_outcomes (player_id, outcome)
  SELECT d.player_id,
         CASE
           WHEN p.user_id IS NOT NULL AND lower(btrim(coalesce(d.email, ''))) = lower(btrim(u.email::text)) THEN 'linked_auth_email_same'
           WHEN p.user_id IS NOT NULL THEN 'linked_auth_email_differs'
           WHEN NULLIF(btrim(coalesce(d.email, '')), '') IS NULL
                OR lower(btrim(d.email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN 'discarded_blank_or_invalid'
           ELSE 'unlinked_key_kept'
         END
  FROM public.player_private_details d
  JOIN public.players p ON p.id = d.player_id
  LEFT JOIN auth.users u ON u.id = p.user_id;
  GET DIAGNOSTICS v_outcomes = ROW_COUNT;
  IF v_outcomes <> v_rows THEN
    RAISE EXCEPTION 'player email conversion: % contact rows but % outcomes; nothing was changed', v_rows, v_outcomes;
  END IF;
  INSERT INTO public.player_link_keys (player_id, email)
  SELECT d.player_id, lower(btrim(d.email))
  FROM public.player_private_details d
  JOIN public.player_email_migration_outcomes o ON o.player_id = d.player_id AND o.outcome = 'unlinked_key_kept';
  DELETE FROM public.player_private_details;
  RAISE NOTICE 'player email conversion: % rows; %', v_rows,
    (SELECT string_agg(outcome || ' ' || n, ', ' ORDER BY outcome) FROM (
       SELECT outcome, count(*) AS n FROM public.player_email_migration_outcomes GROUP BY outcome) x);
END;
$$;
REVOKE INSERT, UPDATE, DELETE ON public.player_private_details FROM authenticated;

-- Audit: an automatic link has no request JWT; its function names itself through a transaction-local setting.
CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_new jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_row jsonb := COALESCE(v_new, v_old);
  v_keys text[] := string_to_array(COALESCE(NULLIF(TG_ARGV[0], ''), 'id'), ',');
  v_private text[] := COALESCE(string_to_array(NULLIF(TG_ARGV[1], ''), ','), '{}');
  v_noise text[] := COALESCE(string_to_array(NULLIF(TG_ARGV[2], ''), ','), '{}') || ARRAY['created_at', 'updated_at'];
  v_changes jsonb := '{}'::jsonb;
  v_claims jsonb;
  v_key text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      CONTINUE WHEN v_key = ANY (v_noise) OR (v_new -> v_key) IS NOT DISTINCT FROM (v_old -> v_key);
      v_changes := v_changes || jsonb_build_object(v_key,
        CASE WHEN v_key = ANY (v_private) THEN jsonb_build_object('changed', true)
             ELSE jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key) END);
    END LOOP;
    IF v_changes = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
  ELSE
    FOR v_key IN SELECT jsonb_object_keys(v_row) LOOP
      CONTINUE WHEN v_key = ANY (v_noise);
      v_changes := v_changes || jsonb_build_object(v_key,
        CASE WHEN v_key = ANY (v_private) AND jsonb_typeof(v_row -> v_key) <> 'null' THEN to_jsonb('[redacted]'::text)
             ELSE v_row -> v_key END);
    END LOOP;
  END IF;

  BEGIN
    v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    v_claims := NULL;
  END;

  INSERT INTO public.audit_log (actor_id, actor_role, action, table_name, record_id, changes)
  VALUES (
    auth.uid(),
    COALESCE(v_claims ->> 'role', NULLIF(current_setting('app.audit_actor_role', true), ''), session_user::text),
    lower(TG_OP),
    TG_TABLE_NAME,
    (SELECT string_agg(v_row ->> k, ':' ORDER BY ord) FROM unnest(v_keys) WITH ORDINALITY AS u(k, ord)),
    v_changes
  );
  RETURN NULL;
END;
$$;

-- Guards -----------------------------------------------------------------------------------------------------------

-- True for a request through the Data API (any JWT: a user, anon or the server key); false for migrations, the seed
-- and Auth's own writes.
CREATE FUNCTION public.is_api_request()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $$ SELECT NULLIF(current_setting('request.jwt.claims', true), '') IS NOT NULL $$;

-- The link: as before (dictator or no request JWT; verified accounts only), and a linked player is never moved to
-- another account in one step: unlink first. Two dictators linking at once cannot overwrite each other.
CREATE OR REPLACE FUNCTION public.players_account_link_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.user_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.user_id IS NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.user_id) THEN
    RETURN NEW;
  END IF;
  IF public.is_api_request() AND NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can link a player to an account' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.user_id IS NOT NULL AND NEW.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'This player is already linked to another account; unlink it first' USING ERRCODE = '23505';
  END IF;
  IF NEW.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.user_id AND u.email_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Only a verified account can be linked to a player' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- A new player identity needs an account (created by create_player_for_account).
CREATE FUNCTION public.players_require_account()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF NEW.user_id IS NULL AND public.is_api_request() THEN
    RAISE EXCEPTION 'A new player needs a verified account: choose the account first' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER players_require_account BEFORE INSERT ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.players_require_account();

-- A new roster place needs a linked player. Existing places of unlinked players are kept, moved and removed as before.
CREATE FUNCTION public.roster_memberships_require_linked_player()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.player_id IS NOT DISTINCT FROM OLD.player_id THEN RETURN NEW; END IF;
  IF public.is_api_request() AND EXISTS (SELECT 1 FROM public.players p WHERE p.id = NEW.player_id AND p.user_id IS NULL) THEN
    RAISE EXCEPTION 'This player is not linked to an account yet. Link them to a verified account before adding them to a roster.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER roster_memberships_require_linked_player BEFORE INSERT OR UPDATE OF player_id ON public.roster_memberships
  FOR EACH ROW EXECUTE FUNCTION public.roster_memberships_require_linked_player();

-- A linked player no longer has a match key, whichever path linked it.
CREATE FUNCTION public.players_drop_link_key()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  DELETE FROM public.player_link_keys WHERE player_id = NEW.id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER players_drop_link_key AFTER INSERT OR UPDATE OF user_id ON public.players
  FOR EACH ROW WHEN (NEW.user_id IS NOT NULL) EXECUTE FUNCTION public.players_drop_link_key();

REVOKE INSERT ON public.players FROM authenticated;

-- Reading --------------------------------------------------------------------------------------------------------

-- A player's latest roster place, as "Team · Season (Division)", to tell players apart.
CREATE FUNCTION public.player_latest_place(p_player uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT t.name || ' · ' || s.name || ' (' || d.name || ')'
  FROM public.roster_memberships m
  JOIN public.seasons s ON s.id = m.season_id
  JOIN public.divisions d ON d.id = s.division_id
  JOIN public.team_entries e ON e.id = m.team_entry_id
  JOIN public.teams t ON t.id = e.team_id
  WHERE m.player_id = p_player
  ORDER BY s.starts_on DESC NULLS LAST, s.sort_order DESC
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.player_latest_place(uuid) FROM PUBLIC, anon, authenticated;

-- Verified accounts found by their Auth email (at least two characters), with the player each is linked to and any
-- unlinked player whose match key equals it.
CREATE FUNCTION public.verified_accounts_for_linking(p_query text)
RETURNS TABLE (user_id uuid, email text, linked_player_id uuid, linked_player_name text, linked_player_place text,
               key_player_id uuid, key_player_name text, key_player_place text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT u.id, u.email::text, lp.id, NULLIF(btrim(lp.first_name || ' ' || lp.last_name), ''), public.player_latest_place(lp.id),
         kp.id, NULLIF(btrim(kp.first_name || ' ' || kp.last_name), ''), public.player_latest_place(kp.id)
  FROM auth.users u
  LEFT JOIN public.players lp ON lp.user_id = u.id
  LEFT JOIN LATERAL (
    SELECT p.* FROM public.player_link_keys k JOIN public.players p ON p.id = k.player_id
    WHERE k.email = lower(btrim(u.email::text)) AND p.user_id IS NULL
    ORDER BY p.id LIMIT 1
  ) kp ON true
  WHERE public.is_dictator()
    AND u.email_confirmed_at IS NOT NULL
    AND char_length(btrim(coalesce(p_query, ''))) >= 2
    AND u.email::text ILIKE '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  ORDER BY u.email
  LIMIT 20;
$$;

-- Link status of the given players, with the linked account's Auth email (the player's only email).
DROP FUNCTION public.player_link_status(uuid[]);
CREATE FUNCTION public.player_link_status(p_player_ids uuid[])
RETURNS TABLE (player_id uuid, linked boolean, account_label text, email text, has_key boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT p.id, p.user_id IS NOT NULL,
         CASE WHEN p.user_id IS NULL THEN NULL ELSE public.account_label(p.user_id) END,
         (SELECT u.email::text FROM auth.users u WHERE u.id = p.user_id),
         EXISTS (SELECT 1 FROM public.player_link_keys k WHERE k.player_id = p.id)
  FROM public.players p
  WHERE public.is_dictator() AND p.id = ANY (p_player_ids);
$$;

-- The matching preview, live: one row per unlinked player with a key.
--   ready                  one unlinked player's key equals one verified, unlinked account's email
--   waiting_verification   the account exists but its email is not verified yet
--   no_account             no account has this email
--   duplicate              several unlinked players share this key
--   conflict               the account is already linked to another player
CREATE FUNCTION public.account_link_matches()
RETURNS TABLE (player_id uuid, player_name text, player_place text, email text, user_id uuid, status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can review account matches' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH keys AS (
    SELECT k.player_id, k.email, p.first_name, p.last_name, count(*) OVER (PARTITION BY k.email) AS sharing
    FROM public.player_link_keys k JOIN public.players p ON p.id = k.player_id
    WHERE p.user_id IS NULL
  )
  SELECT k.player_id, NULLIF(btrim(k.first_name || ' ' || k.last_name), ''), public.player_latest_place(k.player_id), k.email, u.id,
         CASE
           WHEN k.sharing > 1 THEN 'duplicate'
           WHEN u.id IS NULL THEN 'no_account'
           WHEN u.email_confirmed_at IS NULL THEN 'waiting_verification'
           WHEN EXISTS (SELECT 1 FROM public.players o WHERE o.user_id = u.id) THEN 'conflict'
           ELSE 'ready'
         END
  FROM keys k
  LEFT JOIN auth.users u ON lower(btrim(u.email::text)) = k.email
  ORDER BY 6, 2, 1;
END;
$$;

-- Linking ----------------------------------------------------------------------------------------------------------

-- Links one player to one account under the email's lock; the UPDATE only takes an unlinked player, so concurrent links
-- of the same player or the same account cannot both succeed. Returns true when linked.
CREATE FUNCTION public.link_player_account_locked(p_player uuid, p_user uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_email text;
BEGIN
  SELECT lower(btrim(email::text)) INTO v_email FROM auth.users WHERE id = p_user;
  PERFORM pg_advisory_xact_lock(hashtextextended('player-account-link:' || coalesce(v_email, p_user::text), 0));
  IF EXISTS (SELECT 1 FROM public.players WHERE user_id = p_user AND id <> p_player) THEN
    RAISE EXCEPTION 'That account is already linked to another player' USING ERRCODE = '23505';
  END IF;
  UPDATE public.players SET user_id = p_user WHERE id = p_player AND (user_id IS NULL OR user_id = p_user);
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.link_player_account_locked(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.link_player_account(p_player uuid, p_user uuid)
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
  IF NOT public.link_player_account_locked(p_player, p_user) THEN
    RAISE EXCEPTION 'This player is already linked to another account; unlink it first' USING ERRCODE = '23505';
  END IF;
END;
$$;

-- Applies the previewed ready matches ([{player_id, user_id}]): each pair is linked only if it is still a ready match
-- now; anything else is skipped and reported. Never by name. Returns {linked, skipped: [{player_id, status}]}.
CREATE FUNCTION public.apply_account_link_matches(p_expected jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  r record;
  v_linked integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_status text;
  v_now jsonb;
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can apply account matches' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_expected) IS DISTINCT FROM 'array' OR jsonb_array_length(p_expected) > 1000 THEN
    RAISE EXCEPTION 'Send the previewed matches (at most 1000)' USING ERRCODE = '22023';
  END IF;
  -- The matches as they are now, once: player -> {user_id, status}. A pair whose account is no longer the player's
  -- match is reported as changed; otherwise with its current status.
  SELECT COALESCE(jsonb_object_agg(m.player_id::text, jsonb_build_object('user_id', m.user_id, 'status', m.status)), '{}'::jsonb) INTO v_now
  FROM public.account_link_matches() m;
  FOR r IN SELECT DISTINCT (e ->> 'player_id')::uuid AS player_id, (e ->> 'user_id')::uuid AS user_id
           FROM jsonb_array_elements(p_expected) e LOOP
    v_status := CASE WHEN (v_now -> r.player_id::text ->> 'user_id') IS DISTINCT FROM r.user_id::text THEN 'changed'
                     ELSE v_now -> r.player_id::text ->> 'status' END;
    IF v_status IS DISTINCT FROM 'ready' THEN
      v_skipped := v_skipped || jsonb_build_object('player_id', r.player_id, 'status', COALESCE(v_status, 'changed'));
      CONTINUE;
    END IF;
    BEGIN
      IF public.link_player_account_locked(r.player_id, r.user_id) THEN
        v_linked := v_linked + 1;
      ELSE
        v_skipped := v_skipped || jsonb_build_object('player_id', r.player_id, 'status', 'changed');
      END IF;
    EXCEPTION WHEN unique_violation OR check_violation THEN
      v_skipped := v_skipped || jsonb_build_object('player_id', r.player_id, 'status', 'changed');
    END;
  END LOOP;
  RETURN jsonb_build_object('linked', v_linked, 'skipped', v_skipped);
END;
$$;

-- Removes an unlinked player's match key (a typo, or a person who will not sign up).
CREATE FUNCTION public.dismiss_player_link_key(p_player uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can dismiss a match' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.player_link_keys WHERE player_id = p_player;
END;
$$;

-- Automatic link when an account's email becomes verified: the one unlinked player whose key equals the Auth email.
-- Does nothing when the account is linked, unverified, or matches no player or several. Never raises to its caller.
CREATE FUNCTION public.auto_link_verified_account(p_user uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_email text;
  v_players uuid[];
  v_linked boolean := false;
BEGIN
  SELECT lower(btrim(email::text)) INTO v_email FROM auth.users WHERE id = p_user AND email_confirmed_at IS NOT NULL;
  IF v_email IS NULL OR EXISTS (SELECT 1 FROM public.players WHERE user_id = p_user) THEN
    RETURN false;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('player-account-link:' || v_email, 0));
  SELECT array_agg(k.player_id) INTO v_players
  FROM public.player_link_keys k JOIN public.players p ON p.id = k.player_id
  WHERE k.email = v_email AND p.user_id IS NULL;
  IF coalesce(cardinality(v_players), 0) <> 1 THEN
    RETURN false;
  END IF;
  PERFORM set_config('app.audit_actor_role', 'auto-link', true);
  UPDATE public.players SET user_id = p_user WHERE id = v_players[1] AND user_id IS NULL;
  v_linked := FOUND;
  PERFORM set_config('app.audit_actor_role', '', true);
  RETURN v_linked;
END;
$$;
REVOKE ALL ON FUNCTION public.auto_link_verified_account(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.auth_user_auto_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.email_confirmed_at IS NULL) THEN
    BEGIN
      PERFORM public.auto_link_verified_account(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'automatic player link skipped for account %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.auth_user_auto_link() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER on_auth_user_verified_link_player AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.auth_user_auto_link();

-- Account-first players and linked-only roster places ----------------------------------------------------------------

-- Creates a player identity for a verified, unlinked account, links it and puts it on the roster, in one transaction.
-- Refuses (23505) when the account is already linked, or when an unlinked player's match key equals the account's
-- email (that player is very likely the same person: link it instead); the DETAIL is that player's id.
CREATE FUNCTION public.create_player_for_account(
  p_user uuid,
  p_team_entry_id uuid,
  p_first_name text,
  p_last_name text,
  p_jersey_number integer DEFAULT NULL,
  p_position text DEFAULT NULL,
  p_overall_rating integer DEFAULT NULL,
  p_attributes jsonb DEFAULT '{}'::jsonb,
  p_image_url text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_email text;
  v_season uuid;
  v_player uuid;
  v_existing uuid;
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can create players' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_first_name, ''))) NOT BETWEEN 1 AND 100 OR char_length(btrim(COALESCE(p_last_name, ''))) > 100 THEN
    RAISE EXCEPTION 'A first name (up to 100 characters) is required' USING ERRCODE = '22023';
  END IF;
  SELECT lower(btrim(email::text)) INTO v_email FROM auth.users WHERE id = p_user AND email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Choose a verified account for the new player' USING ERRCODE = '23514';
  END IF;
  SELECT season_id INTO v_season FROM public.team_entries WHERE id = p_team_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team entry not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('player-account-link:' || v_email, 0));
  SELECT id INTO v_existing FROM public.players WHERE user_id = p_user;
  IF FOUND THEN
    RAISE EXCEPTION 'That account already has a player; add that player to the roster instead'
      USING ERRCODE = '23505', DETAIL = v_existing::text;
  END IF;
  SELECT k.player_id INTO v_existing FROM public.player_link_keys k JOIN public.players p ON p.id = k.player_id
  WHERE k.email = v_email AND p.user_id IS NULL ORDER BY k.player_id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'An existing player is waiting for this account (same email); link that player instead'
      USING ERRCODE = '23505', DETAIL = v_existing::text;
  END IF;
  INSERT INTO public.players (first_name, last_name, overall_rating, attributes, image_url, user_id)
  VALUES (btrim(p_first_name), btrim(COALESCE(p_last_name, '')), p_overall_rating, COALESCE(p_attributes, '{}'::jsonb), p_image_url, p_user)
  RETURNING id INTO v_player;
  INSERT INTO public.roster_memberships (player_id, team_entry_id, season_id, jersey_number, position)
  VALUES (v_player, p_team_entry_id, v_season, p_jersey_number, NULLIF(btrim(p_position), ''));
  RETURN v_player;
END;
$$;

-- Adds an existing, linked player to a team entry's roster (one place per season, as before).
CREATE FUNCTION public.add_player_to_roster(p_player uuid, p_team_entry_id uuid, p_jersey_number integer DEFAULT NULL, p_position text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_season uuid;
  v_place uuid;
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can change rosters' USING ERRCODE = '42501';
  END IF;
  SELECT season_id INTO v_season FROM public.team_entries WHERE id = p_team_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team entry not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = p_player) THEN
    RAISE EXCEPTION 'Player not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.roster_memberships (player_id, team_entry_id, season_id, jersey_number, position)
  VALUES (p_player, p_team_entry_id, v_season, p_jersey_number, NULLIF(btrim(p_position), ''))
  RETURNING id INTO v_place;
  RETURN v_place;
END;
$$;

-- The signed-in player's own card, with their Auth email (read-only).
CREATE OR REPLACE FUNCTION public.my_player()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'first_name', p.first_name, 'last_name', p.last_name, 'image_url', p.image_url,
    'overall_rating', p.overall_rating, 'attributes', p.attributes,
    'email', (SELECT u.email::text FROM auth.users u WHERE u.id = p.user_id),
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

-- The contact email is gone from the dictator's edit: emails come from the linked account.
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
  IF p_set_email THEN
    RAISE EXCEPTION 'A player''s email comes from their linked account and cannot be set here' USING ERRCODE = '22023';
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

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['verified_accounts_for_linking(text)', 'player_link_status(uuid[])', 'account_link_matches()',
                           'apply_account_link_matches(jsonb)', 'dismiss_player_link_key(uuid)', 'link_player_account(uuid, uuid)',
                           'create_player_for_account(uuid, uuid, text, text, integer, text, integer, jsonb, text)',
                           'add_player_to_roster(uuid, uuid, integer, text)', 'my_player()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.players_require_account() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.roster_memberships_require_linked_player() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.players_drop_link_key() FROM PUBLIC, anon, authenticated;

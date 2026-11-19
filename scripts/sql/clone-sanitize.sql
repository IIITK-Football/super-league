-- Sanitizes a backup restored into the isolated local clone (scripts/backup/restore-drill.sh runs it inside the same
-- transaction as the data load, so nothing unsanitized is ever committed). Never run against a hosted project.
--
-- Emails are pseudonymized consistently: the same normalized address always becomes the same synthetic address, so
-- account matching, duplicates and conflicts behave as in production; blank stays blank and a value that is not an
-- email stays not an email. Names become pseudonyms (consistently per normalized full name for players and legacy team
-- members, which some migrations match by name). Passwords, tokens, phone numbers, Auth metadata, portraits and audit
-- change payloads are cleared. Ids, relationships, roles and verification states are kept. The salt is random and
-- never stored. Works on any schema version: each column is sanitized only if it exists.
CREATE TEMP TABLE _salt ON COMMIT DROP AS SELECT gen_random_uuid()::text AS s;
CREATE FUNCTION pg_temp.pmail(e text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN e IS NULL THEN NULL
    WHEN btrim(e) = '' THEN e
    WHEN lower(btrim(e)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      THEN 'invalid-' || left(md5((SELECT s FROM _salt) || 'x' || lower(btrim(e))), 10)
    ELSE 'u-' || left(md5((SELECT s FROM _salt) || lower(btrim(e))), 12) || '@iiitkottayam.ac.in'
  END $$;
CREATE FUNCTION pg_temp.pname(full_name text, part text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE part WHEN 'first' THEN 'p' ELSE '' END
    || left(md5((SELECT s FROM _salt) || part || lower(regexp_replace(btrim(coalesce(full_name, '')), '\s+', ' ', 'g'))), 6) $$;
CREATE FUNCTION pg_temp.has_col(t text, c text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = split_part(t, '.', 1)
                 AND table_name = split_part(t, '.', 2) AND column_name = c) $$;

UPDATE auth.users SET
  email = pg_temp.pmail(email), encrypted_password = '', phone = NULL, raw_user_meta_data = '{}'::jsonb,
  confirmation_token = '', recovery_token = '', email_change_token_new = '', email_change_token_current = '',
  email_change = '', reauthentication_token = '', phone_change = '', phone_change_token = '';
UPDATE auth.identities SET
  provider_id = CASE WHEN provider = 'email' THEN user_id::text ELSE left(md5((SELECT s FROM _salt) || provider_id), 21) END;
UPDATE auth.identities SET
  identity_data = jsonb_strip_nulls(jsonb_build_object('sub', provider_id, 'email', pg_temp.pmail(identity_data ->> 'email'),
                                                       'email_verified', identity_data -> 'email_verified'));

DO $$
BEGIN
  IF pg_temp.has_col('public.user_profiles', 'email') THEN
    UPDATE public.user_profiles SET email = pg_temp.pmail(email);
  END IF;
  IF pg_temp.has_col('public.user_profiles', 'real_name') THEN
    UPDATE public.user_profiles SET real_name = CASE WHEN real_name IS NULL THEN NULL ELSE 'Person ' || left(md5((SELECT s FROM _salt) || 'r' || id::text), 6) END;
  END IF;
  IF pg_temp.has_col('public.user_profiles', 'nickname') THEN
    UPDATE public.user_profiles SET nickname = CASE WHEN nickname IS NULL THEN NULL ELSE 'person' || left(md5((SELECT s FROM _salt) || 'n' || id::text), 6) END;
  END IF;
  IF pg_temp.has_col('public.players', 'first_name') THEN
    UPDATE public.players SET first_name = pg_temp.pname(first_name || ' ' || last_name, 'first'),
                              last_name = pg_temp.pname(first_name || ' ' || last_name, 'last'), image_url = NULL;
  END IF;
  IF pg_temp.has_col('public.team_members', 'email') THEN
    UPDATE public.team_members SET
      email = pg_temp.pmail(email),
      first_name = pg_temp.pname(COALESCE(NULLIF(btrim(concat_ws(' ', first_name, last_name)), ''), name), 'first'),
      last_name = pg_temp.pname(COALESCE(NULLIF(btrim(concat_ws(' ', first_name, last_name)), ''), name), 'last'),
      name = pg_temp.pname(COALESCE(NULLIF(btrim(concat_ws(' ', first_name, last_name)), ''), name), 'first') || ' '
             || pg_temp.pname(COALESCE(NULLIF(btrim(concat_ws(' ', first_name, last_name)), ''), name), 'last'),
      image_url = NULL;
  END IF;
  IF pg_temp.has_col('public.player_private_details', 'email') THEN
    EXECUTE 'UPDATE public.player_private_details SET email = pg_temp.pmail(email)';
  END IF;
  IF pg_temp.has_col('public.player_link_keys', 'email') THEN
    EXECUTE 'UPDATE public.player_link_keys SET email = pg_temp.pmail(email)';
  END IF;
  IF pg_temp.has_col('public.audit_log', 'changes') THEN
    EXECUTE 'UPDATE public.audit_log SET changes = ''{}''::jsonb';
  END IF;
END $$;

DO $$
DECLARE bad integer;
BEGIN
  SELECT count(*) INTO bad FROM auth.users
  WHERE (email IS NOT NULL AND btrim(email) <> '' AND email !~ '^(u-[0-9a-f]{12}@iiitkottayam\.ac\.in|invalid-[0-9a-f]{10})$')
     OR encrypted_password <> '' OR phone IS NOT NULL OR raw_user_meta_data <> '{}'::jsonb;
  IF bad > 0 THEN RAISE EXCEPTION 'clone sanitize check: % Auth account(s) still hold personal data or credentials', bad; END IF;
END $$;

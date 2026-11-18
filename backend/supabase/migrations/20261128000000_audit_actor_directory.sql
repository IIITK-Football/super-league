-- Everyone who appears in the audit history, for the Audit History "Changed by" filter: one row per distinct actor
-- across the whole history (not only the loaded page), with a readable label and never a raw id. The label is the
-- sign-in email of the account, which its owner cannot edit, with the profile's real name (else nickname) as context:
-- "Real Name (email)". Profile names and the profile email are self-edited, so they never stand alone: a copied name
-- or a borrowed address cannot make one person look like another. Names of only whitespace are ignored. An actor
-- whose account is gone is labelled as deleted or unavailable; repeated labels (several deleted accounts) are
-- numbered so every option is distinct. Server and system changes have no actor and are not listed. Dictators only:
-- anyone else gets no rows, like the history itself. Security definer so the labels keep working when profile data
-- is no longer publicly readable; it reads only what it returns.
CREATE FUNCTION public.audit_actors()
RETURNS TABLE (actor_id uuid, label text, available boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  WITH named AS (
    SELECT a.actor_id,
           u.id IS NOT NULL AS available,
           NULLIF(regexp_replace(u.email::text, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '') AS email,
           COALESCE(NULLIF(regexp_replace(p.real_name, '^[[:space:]\u00a0]+|[[:space:]\u00a0]+$', '', 'g'), ''),
                    NULLIF(regexp_replace(p.nickname, '^[[:space:]\u00a0]+|[[:space:]\u00a0]+$', '', 'g'), '')) AS name
    FROM (SELECT DISTINCT l.actor_id FROM public.audit_log l WHERE l.actor_id IS NOT NULL) a
    LEFT JOIN public.user_profiles p ON p.id = a.actor_id
    LEFT JOIN auth.users u ON u.id = a.actor_id
    WHERE public.is_dictator()
  ), labelled AS (
    SELECT actor_id, available,
           CASE WHEN NOT available THEN 'Deleted or unavailable account'
                WHEN email IS NOT NULL AND name IS NOT NULL THEN name || ' (' || email || ')'
                WHEN email IS NOT NULL THEN email
                ELSE COALESCE(name, 'Account without an email') END AS base
    FROM named
  )
  SELECT actor_id,
         CASE WHEN count(*) OVER (PARTITION BY base) > 1
              THEN base || ' ' || row_number() OVER (PARTITION BY base ORDER BY actor_id)
              ELSE base END,
         available
  FROM labelled
  ORDER BY 2, 1;
$$;
REVOKE ALL ON FUNCTION public.audit_actors() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_actors() TO authenticated, service_role;

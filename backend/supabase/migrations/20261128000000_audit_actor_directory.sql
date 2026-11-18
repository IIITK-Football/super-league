-- Everyone who appears in the audit history, for the Audit History "Changed by" filter: one row per distinct actor
-- across the whole history (not only the loaded page), with a readable label and never a raw id. The label is the
-- profile's real name, else its nickname, else the account email; an actor whose account is gone is labelled as
-- deleted or unavailable. Server and system changes have no actor and are not listed. Dictators only: anyone else
-- gets no rows, like the history itself. Security definer so the labels keep working when profile emails are no
-- longer publicly readable; it reads only what it returns.
CREATE FUNCTION public.audit_actors()
RETURNS TABLE (actor_id uuid, label text, available boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT a.actor_id,
         CASE WHEN u.id IS NULL AND p.id IS NULL THEN 'Deleted or unavailable account'
              ELSE COALESCE(NULLIF(btrim(p.real_name), ''), NULLIF(btrim(p.nickname), ''), NULLIF(btrim(p.email), ''),
                            NULLIF(btrim(u.email), ''), 'Account without a name or email') END,
         u.id IS NOT NULL
  FROM (SELECT DISTINCT l.actor_id FROM public.audit_log l WHERE l.actor_id IS NOT NULL) a
  LEFT JOIN public.user_profiles p ON p.id = a.actor_id
  LEFT JOIN auth.users u ON u.id = a.actor_id
  WHERE public.is_dictator()
  ORDER BY 2, 1;
$$;
REVOKE ALL ON FUNCTION public.audit_actors() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_actors() TO authenticated, service_role;

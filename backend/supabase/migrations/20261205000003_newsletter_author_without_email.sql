-- An article's byline is public, and so is its audit history. The publish route used to store the publisher's email
-- address (or account id) as the author, so every visitor could read it. The route now writes the publisher's display
-- name. This migration replaces existing email and account-id bylines with the same display name (nickname, then real
-- name, then "Super League Editorial") and refuses an email-looking author from now on.
--
-- The audit trigger is paused for this one scrub only: recording it would copy each old address into the append-only
-- history, which is exactly what the scrub removes from view. Forward-only; the replaced addresses are not kept.

ALTER TABLE public.newsletter DISABLE TRIGGER audit_newsletter;

UPDATE public.newsletter n
SET author = COALESCE(
  (SELECT COALESCE(NULLIF(btrim(p.nickname), ''), NULLIF(btrim(p.real_name), ''))
   FROM auth.users u JOIN public.user_profiles p ON p.id = u.id
   WHERE lower(u.email) = lower(btrim(n.author)) OR u.id::text = btrim(n.author)
   LIMIT 1),
  'Super League Editorial')
WHERE n.author LIKE '%@%'
   OR btrim(n.author) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

ALTER TABLE public.newsletter ENABLE TRIGGER audit_newsletter;

ALTER TABLE public.newsletter
  ADD CONSTRAINT newsletter_author_not_email CHECK (author IS NULL OR author NOT LIKE '%@%');

-- Retire the legacy stored role 'admin' (owner decision 2026-11-19). The roles are user (default), captain, scorer,
-- editor and dictator; no legacy admin is ported or promoted. 20261129000000 already removed every privilege of
-- 'admin'. Here any account still holding it becomes an ordinary user (the role row is kept as 'default', so the Auth
-- account and profile are untouched and the audit history records each change), the value can no longer be stored,
-- and the unused get_user_role() helper is dropped. is_role_manager() stays (dictator-only) until the scoped roles
-- replace it.
DO $$
DECLARE
  n integer;
BEGIN
  UPDATE public.user_roles SET role = 'default' WHERE role = 'admin';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'legacy admin assignments removed: % (each account is now an ordinary user)', n;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    RAISE EXCEPTION 'legacy admin assignments remain; nothing was changed';
  END IF;
END;
$$;

ALTER TABLE public.user_roles DROP CONSTRAINT user_roles_role_check;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_role_check
  CHECK (role = ANY (ARRAY['default'::text, 'editor'::text, 'captain'::text, 'dictator'::text]));

DROP FUNCTION public.get_user_role();

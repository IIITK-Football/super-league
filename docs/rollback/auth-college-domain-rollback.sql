-- Rollback for migration 20261117000000_auth_college_domain_and_new_user_triggers.sql
--
-- NOT part of the migration chain. Apply it only through the approved release process, and only
-- if the stricter domain check or the email-change trigger causes a problem. It changes no rows.
--
-- Before applying the forward migration to production, save the hosted definitions so they can be
-- restored exactly if they differ from the baseline versions below:
--   select pg_get_functiondef('public.enforce_college_domain()'::regprocedure);
--   select pg_get_functiondef('public.handle_new_user()'::regprocedure);
--   select tgname, pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;
--
-- Deliberately kept: ensure_domain_lock (new accounts), on_auth_user_created and
-- on_auth_user_role_created. Dropping those would stop new users getting a profile and role.

BEGIN;

-- Previous domain check (case-sensitive suffix match), as in the baseline.
CREATE OR REPLACE FUNCTION public.enforce_college_domain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF new.email NOT LIKE '%@iiitkottayam.ac.in' THEN
    RAISE EXCEPTION 'Access denied: You must use a valid IIIT Kottayam student email address.';
  END IF;
  RETURN new;
END;
$$;

-- Previous profile bootstrap, as in the baseline.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, real_name)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name');
  RETURN new;
END;
$$;

-- The email-change guard did not exist before the migration.
DROP TRIGGER IF EXISTS ensure_domain_lock_on_email_change ON auth.users;

COMMIT;

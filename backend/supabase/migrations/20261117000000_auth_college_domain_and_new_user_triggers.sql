-- College-domain rule and new-user bootstrap for Supabase Auth.
--
-- The earlier baseline only dumped the public schema, so the triggers that the hosted project
-- gained through legacy migrations (domain lock, profile row, default role) were missing from a
-- fresh local database. This migration recreates them idempotently under the same names, and
-- tightens the domain check (case-insensitive, exact domain, no empty email).

CREATE OR REPLACE FUNCTION public.enforce_college_domain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.email IS NULL OR lower(NEW.email) !~ '^[^@[:space:]]+@iiitkottayam\.ac\.in$' THEN
    RAISE EXCEPTION 'Access denied: You must use a valid IIIT Kottayam student email address.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_college_domain() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, real_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- New accounts must use the college domain.
DROP TRIGGER IF EXISTS ensure_domain_lock ON auth.users;
CREATE TRIGGER ensure_domain_lock
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_college_domain();

-- An existing account cannot be moved to a non-college email.
DROP TRIGGER IF EXISTS ensure_domain_lock_on_email_change ON auth.users;
CREATE TRIGGER ensure_domain_lock_on_email_change
  BEFORE UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (NEW.email IS DISTINCT FROM OLD.email)
  EXECUTE FUNCTION public.enforce_college_domain();

-- Every new account gets a profile row and the default role.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS on_auth_user_role_created ON auth.users;
CREATE TRIGGER on_auth_user_role_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();

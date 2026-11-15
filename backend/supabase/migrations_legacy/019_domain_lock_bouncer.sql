-- 1. Create the Bouncer Function
CREATE OR REPLACE FUNCTION public.enforce_college_domain()
RETURNS trigger AS $$
BEGIN
  -- Check if the email ends with the exact IIIT Kottayam domain
  IF new.email NOT LIKE '%@iiitkottayam.ac.in' THEN
    RAISE EXCEPTION 'Access denied: You must use a valid IIIT Kottayam student email address.';
  END IF;
  
  -- If it passes, allow the user to be created!
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Attach the Bouncer to the front door of the auth system
CREATE TRIGGER ensure_domain_lock
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.enforce_college_domain();
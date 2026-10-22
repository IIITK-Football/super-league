-- Pin search_path on SECURITY DEFINER functions so they can't be hijacked
-- by objects created in another schema. No behavior change.
ALTER FUNCTION public.increment_vote(UUID) SET search_path = public;
ALTER FUNCTION public.handle_new_user() SET search_path = public;
ALTER FUNCTION public.enforce_college_domain() SET search_path = public;

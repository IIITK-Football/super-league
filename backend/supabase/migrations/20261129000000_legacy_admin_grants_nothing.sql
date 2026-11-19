-- The legacy stored role 'admin' grants nothing (SL-003: no role implies another). Until now the baseline still let
-- it manage every role (its own included, so it could make itself a dictator), read every role, registration and
-- prediction, and manage matches and news. This migration only removes those grants and changes no row; the next
-- migration retires the value itself (owner decision 2026-11-19: no legacy admin is ported or promoted). The
-- separate open write policies on matches and news are a known gap closed by the security audit, not here.

-- Role management: dictators only.
CREATE OR REPLACE FUNCTION public.is_role_manager()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'dictator'
  );
$$;

-- Nobody assigns the legacy role any more; the agreed roles are user (default), captain, editor and dictator here
-- (scorer arrives with scoped assignments).
DROP POLICY "Dictators manage roles" ON public.user_roles;
CREATE POLICY "Dictators manage roles" ON public.user_roles
  USING (public.is_role_manager())
  WITH CHECK (role IN ('default', 'captain', 'editor', 'dictator') AND public.is_role_manager());

-- Matches, news, predictions and team registrations: the dictator branch stays, the legacy branch goes. Signed-in
-- callers only, because is_dictator is not executable by anonymous visitors (whose reads use the public policies).
DROP POLICY "Admin all access matches" ON public.matches;
CREATE POLICY "Dictators manage matches" ON public.matches TO authenticated
  USING (public.is_dictator()) WITH CHECK (public.is_dictator());

DROP POLICY "Admin all access newsletter" ON public.newsletter;
CREATE POLICY "Dictators manage newsletter" ON public.newsletter TO authenticated
  USING (public.is_dictator()) WITH CHECK (public.is_dictator());

DROP POLICY "Admin all access predictions" ON public.predictions;
CREATE POLICY "Dictators manage predictions" ON public.predictions TO authenticated
  USING (public.is_dictator()) WITH CHECK (public.is_dictator());

DROP POLICY "Dictators manage all team registrations" ON public.team_registrations;
CREATE POLICY "Dictators manage all team registrations" ON public.team_registrations TO authenticated
  USING (public.is_dictator()) WITH CHECK (public.is_dictator());

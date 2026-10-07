CREATE OR REPLACE FUNCTION public.is_role_manager()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('dictator', 'admin')
  );
$$;

DROP POLICY IF EXISTS "Users can read their own role" ON public.user_roles;

CREATE POLICY "Users can read their own role"
  ON public.user_roles FOR SELECT
  USING (
    auth.uid() = user_id
    OR public.is_role_manager()
  );

CREATE POLICY "Dictators manage roles"
  ON public.user_roles FOR ALL
  USING (
    public.is_role_manager()
  )
  WITH CHECK (
    role IN ('default', 'captain', 'editor', 'dictator', 'admin')
    AND public.is_role_manager()
  );
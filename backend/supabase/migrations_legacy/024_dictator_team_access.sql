CREATE POLICY "Dictators manage all team registrations"
  ON public.team_registrations FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('dictator', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('dictator', 'admin')));

CREATE POLICY "Dictators manage all team members"
  ON public.team_members FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('dictator', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('dictator', 'admin')));
ALTER TABLE public.team_registrations
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS team_registrations_team_id_idx
  ON public.team_registrations(team_id);

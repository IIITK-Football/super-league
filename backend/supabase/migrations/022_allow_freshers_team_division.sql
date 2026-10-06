ALTER TABLE public.team_registrations
  DROP CONSTRAINT IF EXISTS team_registrations_division_check;

ALTER TABLE public.team_registrations
  ADD CONSTRAINT team_registrations_division_check
  CHECK (division IN ('mens', 'womens', 'freshers'));
-- Freshers registrations create a row in teams before the registration row.
-- Older production databases still have the original men's/women's-only check.
ALTER TABLE public.teams
  DROP CONSTRAINT IF EXISTS teams_division_check;

ALTER TABLE public.teams
  ADD CONSTRAINT teams_division_check
  CHECK (division IN ('mens', 'womens', 'freshers'));

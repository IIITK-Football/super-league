-- Freshers team formation must be accepted by the production registration table.
-- This is intentionally idempotent for environments where migration 022 was skipped.
ALTER TABLE public.team_registrations
  DROP CONSTRAINT IF EXISTS team_registrations_division_check;

ALTER TABLE public.team_registrations
  ADD CONSTRAINT team_registrations_division_check
  CHECK (division IN ('mens', 'womens', 'freshers'));

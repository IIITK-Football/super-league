ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS team_color TEXT;

ALTER TABLE public.teams
  DROP CONSTRAINT IF EXISTS teams_team_color_format_check;

ALTER TABLE public.teams
  ADD CONSTRAINT teams_team_color_format_check
  CHECK (team_color IS NULL OR team_color ~ '^#[0-9A-Fa-f]{6}$');

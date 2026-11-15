-- 1. CHECK CONSTRAINTS: Prevent impossible negative scores in matches
ALTER TABLE public.matches
ADD CONSTRAINT check_positive_scores 
CHECK (home_score >= 0 AND away_score >= 0);

-- 2. UNIQUE CONSTRAINTS: Prevent duplicate jersey numbers on the same team
ALTER TABLE public.players
ADD CONSTRAINT unique_team_jersey 
UNIQUE (team_id, jersey_number);

-- 3. FOREIGN KEY CASCADES: Handle deleted teams gracefully
-- First, drop the default foreign key (Supabase usually names it table_column_fkey)
ALTER TABLE public.players
DROP CONSTRAINT IF EXISTS players_team_id_fkey;

-- Add it back with ON DELETE SET NULL (Players become free agents if team is deleted)
ALTER TABLE public.players
ADD CONSTRAINT players_team_id_fkey
FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;
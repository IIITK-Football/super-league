-- 1. Add a B-tree index to team_id in the Players table
CREATE INDEX IF NOT EXISTS idx_players_team_id 
ON public.players USING btree (team_id);

-- 2. Add indexes to date and status in the Matches table
CREATE INDEX IF NOT EXISTS idx_matches_date 
ON public.matches USING btree (date);

CREATE INDEX IF NOT EXISTS idx_matches_status 
ON public.matches USING btree (status);

-- 3. Add an index to date in the Newsletter table
CREATE INDEX IF NOT EXISTS idx_newsletter_date 
ON public.newsletter USING btree (date);
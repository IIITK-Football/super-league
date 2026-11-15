-- 1. Add the new assists column to the players table
ALTER TABLE public.players 
ADD COLUMN IF NOT EXISTS assists INTEGER DEFAULT 0;

-- 2. Rebuild the top_scorers view to include both goals and assists
CREATE OR REPLACE VIEW public.top_scorers AS
SELECT 
    p.id AS "playerId",
    p.first_name || ' ' || p.last_name AS "playerName",
    t.name AS "teamName",
    COUNT(g.id) AS "goalsScored",
    p.assists AS "assists"
FROM 
    public.players p
LEFT JOIN 
    public.teams t ON p.team_id = t.id
LEFT JOIN 
    public.goals g ON p.id = g.player_id
GROUP BY 
    p.id, p.first_name, p.last_name, t.name, p.assists;

-- 3. Security Check: Make sure the new view still uses Invoker security!
ALTER VIEW public.top_scorers SET (security_invoker = true);
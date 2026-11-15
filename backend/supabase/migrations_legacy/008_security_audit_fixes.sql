-- 1. SECURE THE TABLES (Fixes the 2 RLS Warnings)
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;

-- Add basic public read access so your Next.js frontend can still fetch them!
CREATE POLICY "Allow public read access for teams" 
ON public.teams FOR SELECT USING (true);

CREATE POLICY "Allow public read access for goals" 
ON public.goals FOR SELECT USING (true);

-- 2. SECURE THE VIEWS (Fixes the 3 Security Definer Warnings)
-- This tells Postgres to use the permissions of the user making the request
ALTER VIEW public.top_scorers SET (security_invoker = true);
ALTER VIEW public.league_standings SET (security_invoker = true);
ALTER VIEW public.league_schedule SET (security_invoker = true);
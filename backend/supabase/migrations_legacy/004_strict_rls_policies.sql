-- 1. Enable RLS on all tables (Locks the doors)
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter ENABLE ROW LEVEL SECURITY;

-- 2. MATCHES & STANDINGS POLICIES (Standings is derived from Matches)
CREATE POLICY "Public read matches" 
ON public.matches FOR SELECT USING (true);

CREATE POLICY "Admin all access matches" 
ON public.matches FOR ALL USING (public.get_user_role() = 'admin');

-- 3. PLAYERS POLICIES
CREATE POLICY "Public read players" 
ON public.players FOR SELECT USING (true);

CREATE POLICY "Admin and Captain all access players" 
ON public.players FOR ALL USING (public.get_user_role() IN ('admin', 'captain'));

-- 4. NEWSLETTER POLICIES
CREATE POLICY "Public read newsletter" 
ON public.newsletter FOR SELECT USING (true);

CREATE POLICY "Admin all access newsletter" 
ON public.newsletter FOR ALL USING (public.get_user_role() = 'admin');
CREATE TABLE public.matches (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    season_id TEXT NOT NULL, -- Example: 'season-2026'
    home_team_id UUID NOT NULL, -- Will link to your Teams table
    away_team_id UUID NOT NULL, -- Will link to your Teams table
    match_date TIMESTAMP WITH TIME ZONE NOT NULL,
    status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'live', 'completed')),
    home_score INTEGER NOT NULL DEFAULT 0,
    away_score INTEGER NOT NULL DEFAULT 0,
    stage TEXT NOT NULL DEFAULT 'league' CHECK (stage IN ('group', 'league')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Turn on Row Level Security (RLS)
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

-- 3. Policy: Anyone can view the matches (Public Read Access)
CREATE POLICY "Matches are viewable by everyone" 
ON public.matches FOR SELECT 
USING (true);

-- 4. Policy: Only logged-in admins can create new matches
CREATE POLICY "Only authenticated users can insert matches" 
ON public.matches FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');

-- 5. Policy: Only logged-in admins can update live scores
CREATE POLICY "Only authenticated users can update matches" 
ON public.matches FOR UPDATE 
USING (auth.role() = 'authenticated');

-- 6. Policy: Only logged-in admins can delete matches
CREATE POLICY "Only authenticated users can delete matches" 
ON public.matches FOR DELETE 
USING (auth.role() = 'authenticated');
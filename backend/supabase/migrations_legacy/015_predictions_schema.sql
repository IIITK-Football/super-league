-- 1. Create the Predictions table
CREATE TABLE public.predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    predicted_home_score INTEGER NOT NULL,
    predicted_away_score INTEGER NOT NULL,
    predicted_scorers JSONB DEFAULT '[]'::jsonb,
    predicted_assists JSONB DEFAULT '[]'::jsonb,
    points_awarded INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    
    -- This is the magic line that prevents a user from voting twice on the same match!
    CONSTRAINT unique_user_match_prediction UNIQUE (user_id, match_id)
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;

-- 3. Create RLS Policies
-- Users can read their own predictions
CREATE POLICY "Users can view their own predictions" 
ON public.predictions FOR SELECT 
USING (auth.uid() = user_id);

-- Users can insert their own predictions
CREATE POLICY "Users can insert their own predictions" 
ON public.predictions FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Users can update their own predictions (e.g., changing their mind before kickoff)
CREATE POLICY "Users can update their own predictions" 
ON public.predictions FOR UPDATE 
USING (auth.uid() = user_id);
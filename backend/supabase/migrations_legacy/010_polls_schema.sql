-- 1. Create the Polls table
CREATE TABLE public.polls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_text TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. Create the Poll Options table with a Foreign Key linked to the Polls table
CREATE TABLE public.poll_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    poll_id UUID REFERENCES public.polls(id) ON DELETE CASCADE,
    option_text TEXT NOT NULL,
    vote_count INTEGER DEFAULT 0
);

-- 3. Enable Row Level Security (RLS) on both tables
ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_options ENABLE ROW LEVEL SECURITY;

-- 4. Create Policies to allow public read access
CREATE POLICY "Allow public read access for polls" 
ON public.polls FOR SELECT USING (true);

CREATE POLICY "Allow public read access for poll_options" 
ON public.poll_options FOR SELECT USING (true);
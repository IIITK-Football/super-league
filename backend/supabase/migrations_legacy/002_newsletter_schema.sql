CREATE TABLE public.news (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    subtitle TEXT,
    content TEXT NOT NULL,
    image_url TEXT,
    author TEXT DEFAULT 'The Daily Sweeper',
    category TEXT NOT NULL DEFAULT 'News' CHECK (category IN ('News', 'Satire', 'Official', 'Match Report')),
    published_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Turn on Row Level Security (RLS)
ALTER TABLE public.news ENABLE ROW LEVEL SECURITY;

-- 3. Policy: Anyone can read the news (Public Read Access)
CREATE POLICY "News articles are viewable by everyone" 
ON public.news FOR SELECT 
USING (true);

-- 4. Policy: Only logged-in admins can insert news
CREATE POLICY "Only authenticated users can insert news" 
ON public.news FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');

-- 5. Policy: Only logged-in admins can update news
CREATE POLICY "Only authenticated users can update news" 
ON public.news FOR UPDATE 
USING (auth.role() = 'authenticated');

-- 6. Policy: Only logged-in admins can delete news
CREATE POLICY "Only authenticated users can delete news" 
ON public.news FOR DELETE 
USING (auth.role() = 'authenticated');
-- Add the JSONB column (or update it if it already exists as text)
ALTER TABLE public.newsletter 
ADD COLUMN IF NOT EXISTS content JSONB DEFAULT '[]'::jsonb;
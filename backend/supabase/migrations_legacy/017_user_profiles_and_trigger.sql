-- 1. Create the User Profiles table
CREATE TABLE public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  real_name TEXT,
  nickname TEXT,
  team_flair_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- 3. Create RLS Policies
-- ANYONE can read profiles (We need this so the Leaderboard API can fetch the names!)
CREATE POLICY "Public profiles are viewable by everyone." 
  ON public.user_profiles FOR SELECT USING (true);

-- Users can only update their own profile (For the onboarding screen)
CREATE POLICY "Users can update own profile." 
  ON public.user_profiles FOR UPDATE USING (auth.uid() = id);

-- 4. Create the Trigger Function (The Google Payload Extractor)
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, real_name)
  VALUES (
    new.id,
    new.email,
    -- This specifically targets the JSON payload Google sends to Supabase!
    new.raw_user_meta_data->>'full_name' 
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Attach the Trigger to the hidden auth.users table
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
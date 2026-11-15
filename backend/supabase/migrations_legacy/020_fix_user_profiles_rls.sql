-- Fix: user_profiles was missing an INSERT policy for the auth trigger.
-- The trigger (handle_new_user) runs as SECURITY DEFINER so it bypasses RLS,
-- but we add this for completeness and any manual inserts.

-- Allow the trigger / service role to insert profiles
CREATE POLICY "Service role can insert profiles"
  ON public.user_profiles FOR INSERT
  WITH CHECK (true);

-- Note: The old 'profiles' table (migration 014) is now superseded by 'user_profiles' (migration 017).
-- All frontend code and middleware now consistently use 'user_profiles'.
-- The 'profiles' table can be dropped once confirmed no data exists in it:
-- DROP TABLE IF EXISTS public.profiles;

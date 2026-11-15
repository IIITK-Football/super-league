-- 1. BACKFILL OLD USERS: Find any users in auth.users who don't have a profile yet, and create one for them!
INSERT INTO public.user_profiles (id, email, real_name)
SELECT id, email, raw_user_meta_data->>'full_name'
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.user_profiles);

-- 2. BUILD THE BRIDGE: Tell the predictions table how to connect directly to the user_profiles table
ALTER TABLE public.predictions 
ADD CONSTRAINT fk_predictions_user_profiles 
FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) 
ON DELETE CASCADE;
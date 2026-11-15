-- 1. Create the User Roles table
CREATE TABLE public.user_roles (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    role TEXT CHECK (role IN ('admin', 'captain')) NOT NULL
);

-- 2. Turn on Row Level Security (RLS)
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 3. Allow users to read their own role
CREATE POLICY "Users can read their own role" 
ON public.user_roles FOR SELECT 
USING (auth.uid() = user_id);

-- 4. Create the Supabase RPC (Remote Procedure Call)
-- This allows our Next.js backend to easily ask: "What is my role?"
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT role FROM public.user_roles WHERE user_id = auth.uid();
$$;
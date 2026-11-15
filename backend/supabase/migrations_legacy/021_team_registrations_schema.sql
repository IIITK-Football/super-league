CREATE TABLE public.team_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  captain_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  team_name TEXT NOT NULL CHECK (char_length(team_name) BETWEEN 2 AND 60),
  division TEXT NOT NULL DEFAULT 'mens' CHECK (division IN ('mens', 'womens', 'freshers')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL REFERENCES public.team_registrations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  email TEXT,
  position TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.team_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Captains manage their team" ON public.team_registrations FOR ALL USING (auth.uid() = captain_id) WITH CHECK (auth.uid() = captain_id);
CREATE POLICY "Team members follow captain access" ON public.team_members FOR ALL USING (EXISTS (SELECT 1 FROM public.team_registrations registration WHERE registration.id = registration_id AND registration.captain_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.team_registrations registration WHERE registration.id = registration_id AND registration.captain_id = auth.uid()));
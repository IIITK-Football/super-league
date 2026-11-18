-- Migration rehearsal fixture (legacy schema), loaded after the pre-SL-021 seed: a second "Carmen Berzatto" on
-- The Beef's 2026 roster makes the seed's Freshers member of that name ambiguous. The roster migration must stop,
-- list the member, and change nothing.
INSERT INTO public.players (id, team_id, team_entry_id, first_name, last_name, jersey_number)
SELECT 'a6000000-0000-4000-8000-000000000001', e.team_id, e.id, 'carmen', ' Berzatto ', 50
FROM public.team_entries e WHERE e.team_id = md5('mega-team:freshers:BEEF')::uuid;

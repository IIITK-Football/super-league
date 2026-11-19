-- Migration rehearsal fixture (legacy schema, before 20261124000000), loaded after the pre-SL-021 seed.
-- Adds the cases the seed alone does not cover, then records the values the migration must preserve.
--   * a Freshers member with no matching player (becomes a new identity with the member's id, and its email);
--   * a linked member's id in match JSON (as a string and as an object) and in a prediction (must be rewritten);
--   * an unmatched member's id in match JSON and a prediction (must stay as it is).
-- The seed's 16 Freshers members each match exactly one player on their team (the linked path).

INSERT INTO public.team_members (id, registration_id, name, first_name, last_name, email, position, jersey_number, overall_rating, attributes)
VALUES ('a5000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', 'Nova Fresher', 'Nova', 'Fresher',
        'Nova.Fresher@iiitkottayam.ac.in', 'ST', 42, 61, '{"pace": 70}');

CREATE TABLE public._rehearsal_ids AS
SELECT md5('mega-member:70000000-0000-4000-8000-000000000001:1')::uuid AS linked_member,
       md5('mega-player:' || md5('mega-team:freshers:BEEF')::uuid::text || ':1')::uuid AS linked_player,
       'a5000000-0000-4000-8000-000000000001'::uuid AS created_member,
       (SELECT m.id FROM public.matches m JOIN public.seasons s ON s.id = m.season_id JOIN public.divisions d ON d.id = s.division_id
        WHERE d.slug = 'freshers' ORDER BY m.id LIMIT 1) AS match_id,
       (SELECT p.id FROM public.predictions p ORDER BY p.id LIMIT 1) AS prediction_id;

UPDATE public.matches m
SET scorers = COALESCE(m.scorers, '[]'::jsonb)
              || jsonb_build_array(i.linked_member::text, jsonb_build_object('player_id', i.linked_member::text, 'minute', '5'), i.created_member::text),
    assists = COALESCE(m.assists, '[]'::jsonb) || jsonb_build_array(i.linked_member::text)
FROM public._rehearsal_ids i WHERE m.id = i.match_id;

UPDATE public.predictions p
SET predicted_scorers = jsonb_build_array(i.linked_member::text, i.created_member::text),
    predicted_assists = jsonb_build_array(i.linked_member::text)
FROM public._rehearsal_ids i WHERE p.id = i.prediction_id;

CREATE TABLE public._rehearsal_before AS
SELECT (SELECT count(*) FROM public.players)::int AS players,
       (SELECT count(*) FROM public.players WHERE team_entry_id IS NOT NULL)::int AS rostered_players,
       (SELECT count(*) FROM public.team_members)::int AS members,
       (SELECT count(*) FROM public.goals)::int AS goals,
       (SELECT COALESCE(sum(points_awarded), 0) FROM public.predictions)::int AS points,
       (SELECT assists FROM public.players WHERE id = (SELECT linked_player FROM public._rehearsal_ids)) AS linked_player_counter,
       (SELECT overall_rating FROM public.team_members WHERE id = (SELECT linked_member FROM public._rehearsal_ids)) AS linked_member_rating,
       (SELECT overall_rating FROM public.players WHERE id = (SELECT linked_player FROM public._rehearsal_ids)) AS linked_player_rating;

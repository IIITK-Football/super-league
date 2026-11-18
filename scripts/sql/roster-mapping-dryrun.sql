-- Read-only dry run of the roster migration (20261124000000_player_identity_rosters.sql) for the legacy schema.
-- The owner runs it on a LOCAL restore of production before the release (as in SL-004 §3a), never against a hosted
-- database from this repository. It changes nothing: everything is a SELECT.
--
-- Output, in order:
--   1. blockers: registrations without a team, jersey numbers outside 0-99, ambiguous members, players claimed by
--      several members, member ids already used by an unrelated player (the migration stops on any of these);
--   2. each team member's predicted outcome (linked / created) and the values the team-builder value would replace;
--   3. how many match JSON and prediction entries would be rewritten.

\echo '== 1. Blockers (the migration stops on any row here)'
WITH members AS (
  SELECT m.*, r.team_id, r.season_id,
         lower(regexp_replace(btrim(COALESCE(NULLIF(btrim(concat_ws(' ', m.first_name, m.last_name)), ''), m.name)), '\s+', ' ', 'g')) AS norm
  FROM public.team_members m JOIN public.team_registrations r ON r.id = m.registration_id
), candidates AS (
  SELECT mb.id AS member_id, p.id AS player_id
  FROM members mb
  JOIN public.team_entries e ON e.team_id = mb.team_id AND e.season_id = mb.season_id
  JOIN public.players p ON p.team_entry_id = e.id
  WHERE lower(regexp_replace(btrim(p.first_name::text || ' ' || p.last_name::text), '\s+', ' ', 'g')) = mb.norm
)
SELECT 'registration without a team' AS blocker, r.id::text AS id, r.team_name AS detail
FROM public.team_registrations r WHERE r.team_id IS NULL AND EXISTS (SELECT 1 FROM public.team_members m WHERE m.registration_id = r.id)
UNION ALL
SELECT 'player jersey outside 0-99', p.id::text, p.jersey_number::text FROM public.players p WHERE p.jersey_number NOT BETWEEN 0 AND 99
UNION ALL
SELECT 'member jersey outside 0-99', m.id::text, m.jersey_number::text FROM public.team_members m WHERE m.jersey_number NOT BETWEEN 0 AND 99
UNION ALL
SELECT 'member matches several players', mb.id::text, mb.name FROM members mb
WHERE (SELECT count(*) FROM candidates c WHERE c.member_id = mb.id) > 1
UNION ALL
SELECT 'player matched by several members', c.player_id::text, string_agg(c.member_id::text, ', ')
FROM candidates c GROUP BY c.player_id HAVING count(*) > 1
UNION ALL
SELECT 'member id used by an unrelated player', mb.id::text, mb.name FROM members mb
WHERE NOT EXISTS (SELECT 1 FROM candidates c WHERE c.member_id = mb.id) AND EXISTS (SELECT 1 FROM public.players p WHERE p.id = mb.id)
ORDER BY 1, 2;

\echo '== 2. Predicted outcome per team member (linked members show the values the team builder would replace)'
WITH members AS (
  SELECT m.*, r.team_id, r.season_id,
         lower(regexp_replace(btrim(COALESCE(NULLIF(btrim(concat_ws(' ', m.first_name, m.last_name)), ''), m.name)), '\s+', ' ', 'g')) AS norm
  FROM public.team_members m JOIN public.team_registrations r ON r.id = m.registration_id
), candidates AS (
  SELECT mb.id AS member_id, p.id AS player_id, p.overall_rating, p.jersey_number, p.position, p.image_url, p.attributes
  FROM members mb
  JOIN public.team_entries e ON e.team_id = mb.team_id AND e.season_id = mb.season_id
  JOIN public.players p ON p.team_entry_id = e.id
  WHERE lower(regexp_replace(btrim(p.first_name::text || ' ' || p.last_name::text), '\s+', ' ', 'g')) = mb.norm
)
SELECT mb.id AS member_id, mb.name,
       CASE (SELECT count(*) FROM candidates c WHERE c.member_id = mb.id) WHEN 0 THEN 'created' WHEN 1 THEN 'linked' ELSE 'AMBIGUOUS' END AS outcome,
       c.player_id,
       concat_ws('; ',
         CASE WHEN mb.overall_rating IS DISTINCT FROM c.overall_rating THEN format('rating %s -> %s', c.overall_rating, mb.overall_rating) END,
         CASE WHEN mb.jersey_number IS NOT NULL AND mb.jersey_number IS DISTINCT FROM c.jersey_number THEN format('jersey %s -> %s', c.jersey_number, mb.jersey_number) END,
         CASE WHEN NULLIF(btrim(mb.position), '') IS NOT NULL AND mb.position IS DISTINCT FROM c.position THEN format('position %s -> %s', c.position, mb.position) END,
         CASE WHEN mb.image_url IS NOT NULL AND mb.image_url IS DISTINCT FROM c.image_url THEN 'portrait replaced' END,
         CASE WHEN mb.attributes IS NOT NULL AND mb.attributes <> '{}'::jsonb AND mb.attributes IS DISTINCT FROM c.attributes THEN 'attributes replaced' END
       ) AS replaced_values
FROM members mb LEFT JOIN candidates c ON c.member_id = mb.id
ORDER BY outcome, mb.name;

\echo '== 3. References that would be rewritten (linked members only)'
WITH members AS (
  SELECT m.id, r.team_id, r.season_id,
         lower(regexp_replace(btrim(COALESCE(NULLIF(btrim(concat_ws(' ', m.first_name, m.last_name)), ''), m.name)), '\s+', ' ', 'g')) AS norm
  FROM public.team_members m JOIN public.team_registrations r ON r.id = m.registration_id
), linked AS (
  SELECT mb.id::text AS member_id
  FROM members mb
  JOIN public.team_entries e ON e.team_id = mb.team_id AND e.season_id = mb.season_id
  JOIN public.players p ON p.team_entry_id = e.id
  WHERE lower(regexp_replace(btrim(p.first_name::text || ' ' || p.last_name::text), '\s+', ' ', 'g')) = mb.norm
), refs AS (
  SELECT 'match' AS kind, CASE jsonb_typeof(el) WHEN 'string' THEN el #>> '{}' ELSE el ->> 'player_id' END AS ref
  FROM public.matches m, jsonb_array_elements(COALESCE(m.scorers, '[]') || COALESCE(m.assists, '[]') || COALESCE(m.own_goals, '[]')) el
  UNION ALL
  SELECT 'prediction', el #>> '{}'
  FROM public.predictions p, jsonb_array_elements(COALESCE(p.predicted_scorers, '[]') || COALESCE(p.predicted_assists, '[]')) el
)
SELECT kind, count(*) AS entries_to_rewrite FROM refs WHERE ref IN (SELECT member_id FROM linked) GROUP BY kind ORDER BY kind;

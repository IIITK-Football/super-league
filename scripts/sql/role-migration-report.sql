-- Read-only report after the roles migration (20261201000000, 20261201000001), for the production-shaped clone and
-- any project. Counts and plain verdicts only: no names, emails or ids. It changes nothing.
BEGIN READ ONLY;
SELECT 'grants by role' AS item, coalesce(string_agg(role || '=' || n, ', ' ORDER BY role), 'none') AS result
FROM (SELECT role, count(*) AS n FROM public.user_roles GROUP BY role) g
UNION ALL SELECT 'stored default or admin grants (must be 0)', (SELECT count(*) FROM public.user_roles WHERE role NOT IN ('captain', 'scorer', 'editor', 'dictator'))::text
UNION ALL SELECT 'captain assignments', (SELECT count(*) FROM public.captain_assignments)::text
UNION ALL SELECT 'registrations kept as history', (SELECT count(*) FROM public.legacy_team_registrations)::text
UNION ALL SELECT 'registrations whose name differed from the team name', (SELECT count(*) FROM public.legacy_team_registrations WHERE registration_name IS DISTINCT FROM team_name)::text
UNION ALL SELECT 'every history row has an assignment on its team entry',
  (NOT EXISTS (SELECT 1 FROM public.legacy_team_registrations l WHERE NOT EXISTS (
     SELECT 1 FROM public.captain_assignments ca JOIN public.team_entries e ON e.id = ca.team_entry_id
     WHERE ca.user_id = l.captain_id AND e.team_id = l.team_id AND e.season_id = l.season_id)))::text
UNION ALL SELECT 'assignments in a season that is no longer writable (history only)',
  (SELECT count(*) FROM public.captain_assignments ca JOIN public.team_entries e ON e.id = ca.team_entry_id WHERE NOT public.season_is_writable(e.season_id))::text
UNION ALL SELECT 'captains whose only assignments are in non-writable seasons (the captain grant lapses at the next season change)',
  (SELECT count(DISTINCT ca.user_id) FROM public.captain_assignments ca
   WHERE NOT EXISTS (SELECT 1 FROM public.captain_assignments c2 JOIN public.team_entries e2 ON e2.id = c2.team_entry_id
                     WHERE c2.user_id = ca.user_id AND public.season_is_writable(e2.season_id)))::text
UNION ALL SELECT 'captain grants without any assignment (cannot act until assigned)',
  (SELECT count(*) FROM public.user_roles r WHERE r.role = 'captain' AND NOT EXISTS (SELECT 1 FROM public.captain_assignments ca WHERE ca.user_id = r.user_id))::text
UNION ALL SELECT 'people holding a captain assignment without the captain grant (cannot act)',
  (SELECT count(DISTINCT ca.user_id) FROM public.captain_assignments ca WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = ca.user_id AND r.role = 'captain'))::text
UNION ALL SELECT 'team_registrations table gone', (to_regclass('public.team_registrations') IS NULL)::text;
ROLLBACK;

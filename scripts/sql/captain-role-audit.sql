-- Read-only audit: team entries whose assigned captain does not hold the captain role.
--
-- The captain function now requires BOTH the team assignment and the captain role, and migration
-- 20261118000000 stops (changing nothing) if any assignment lacks the role. Run this first, review each row, and
-- assign the role deliberately for every person who should be a captain. Nothing here grants anything.
--
-- Run it in the SQL Editor of the project you are about to migrate. It runs in a READ ONLY transaction that is
-- always rolled back. The output contains personal data (emails): keep it to yourself, and share only the
-- count and the role values if you need help.
BEGIN READ ONLY;

SELECT r.id AS team_entry_id,
       r.team_name,
       d.slug AS division,
       s.name AS season,
       r.captain_id,
       u.email AS captain_email,
       COALESCE(ur.role, '(no role row)') AS current_role,
       CASE
         WHEN ur.role IN ('default') OR ur.role IS NULL THEN 'assign the captain role if this person is the captain'
         ELSE 'review by hand: this role is not changed automatically (no role implies another)'
       END AS suggestion
FROM public.team_registrations r
JOIN public.seasons s ON s.id = r.season_id
JOIN public.divisions d ON d.id = s.division_id
LEFT JOIN public.user_roles ur ON ur.user_id = r.captain_id
LEFT JOIN auth.users u ON u.id = r.captain_id
WHERE ur.role IS DISTINCT FROM 'captain' AND ur.role IS DISTINCT FROM 'dictator'
ORDER BY d.slug, s.name, r.team_name;

ROLLBACK;

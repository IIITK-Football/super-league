-- Read-only checks that the team member function is closed and correct on a project. Every row should say
-- passed = t. Run it in the SQL Editor of staging or production after the migration (it changes nothing:
-- a READ ONLY transaction that is always rolled back). The last check reads only a count of team entries.
BEGIN READ ONLY;

WITH f AS (
  SELECT 'public.captain_update_team_member(uuid,text,integer,integer,jsonb,text,text)'::regprocedure AS seven,
         'public.captain_update_team_member(uuid,text,integer,integer,jsonb)'::regprocedure AS five
)
SELECT check_name, passed
FROM (
  SELECT 1 AS n, '7-argument: anonymous callers cannot execute' AS check_name,
         NOT has_function_privilege('anon', seven, 'EXECUTE') AS passed FROM f
  UNION ALL
  SELECT 2, '5-argument: anonymous callers cannot execute', NOT has_function_privilege('anon', five, 'EXECUTE') FROM f
  UNION ALL
  SELECT 3, '7-argument: PUBLIC has no execute',
         (SELECT p.proacl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
          FROM pg_proc p WHERE p.oid = f.seven) FROM f
  UNION ALL
  SELECT 4, '5-argument: PUBLIC has no execute',
         (SELECT p.proacl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
          FROM pg_proc p WHERE p.oid = f.five) FROM f
  UNION ALL
  SELECT 5, '7-argument: signed-in users can execute (the function then checks assignment and role)',
         has_function_privilege('authenticated', seven, 'EXECUTE') FROM f
  UNION ALL
  SELECT 6, '7-argument: runs with the owner''s rights (security definer)',
         (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = f.seven) FROM f
  UNION ALL
  SELECT 7, '7-argument: search_path is pinned to empty',
         (SELECT p.proconfig @> ARRAY['search_path=""'] FROM pg_proc p WHERE p.oid = f.seven) FROM f
  UNION ALL
  SELECT 8, '7-argument: body requires a signed-in caller',
         pg_get_functiondef(seven) LIKE '%auth.uid()%' FROM f
  UNION ALL
  SELECT 9, '7-argument: body requires the captain role as well as the assignment',
         pg_get_functiondef(seven) LIKE '%Captain access is required%' FROM f
  UNION ALL
  SELECT 10, '7-argument: body keeps the email for dictators only',
         pg_get_functiondef(seven) LIKE '%Only a dictator can change%' FROM f
  UNION ALL
  SELECT 11, 'every assigned team captain holds the captain role (or is a dictator)',
         NOT EXISTS (SELECT 1 FROM public.team_registrations r
                     LEFT JOIN public.user_roles ur ON ur.user_id = r.captain_id
                     WHERE ur.role IS DISTINCT FROM 'captain' AND ur.role IS DISTINCT FROM 'dictator')
) c
ORDER BY n;

ROLLBACK;

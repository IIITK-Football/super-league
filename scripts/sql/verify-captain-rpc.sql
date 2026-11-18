-- Read-only checks that the captain roster function is closed and correct on a project. Every row should say
-- passed = t. Run it in the SQL Editor of staging or production after the migrations (it changes nothing: a READ
-- ONLY transaction that is always rolled back). captain_update_roster_player replaced captain_update_team_member when
-- the Freshers member table became season roster memberships (20261124000000, 20261125000000); the retired
-- overloads must be gone. The last check reads only a count of registrations.
BEGIN READ ONLY;

WITH f AS (
  SELECT to_regprocedure('public.captain_update_roster_player(uuid,text,integer,integer,jsonb,text)') AS fn
)
SELECT check_name, passed
FROM (
  SELECT 1 AS n, 'the roster function exists' AS check_name, fn IS NOT NULL AS passed FROM f
  UNION ALL
  SELECT 2, 'anonymous callers cannot execute it', fn IS NOT NULL AND NOT has_function_privilege('anon', fn, 'EXECUTE') FROM f
  UNION ALL
  SELECT 3, 'PUBLIC has no execute',
         (SELECT p.proacl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
          FROM pg_proc p WHERE p.oid = f.fn) IS TRUE FROM f
  UNION ALL
  SELECT 4, 'signed-in users can execute it (the function then checks assignment and role)',
         fn IS NOT NULL AND has_function_privilege('authenticated', fn, 'EXECUTE') FROM f
  UNION ALL
  SELECT 5, 'runs with the owner''s rights (security definer)', (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = f.fn) IS TRUE FROM f
  UNION ALL
  SELECT 6, 'search_path is pinned to empty', (SELECT p.proconfig @> ARRAY['search_path=""'] FROM pg_proc p WHERE p.oid = f.fn) IS TRUE FROM f
  UNION ALL
  SELECT 7, 'body requires a signed-in caller', fn IS NOT NULL AND pg_get_functiondef(fn) LIKE '%auth.uid()%' FROM f
  UNION ALL
  SELECT 8, 'body requires the captain role as well as the assignment', fn IS NOT NULL AND pg_get_functiondef(fn) LIKE '%Captain access is required%' FROM f
  UNION ALL
  SELECT 9, 'it takes only the allow-listed arguments',
         fn IS NOT NULL AND pg_get_function_identity_arguments(fn) = 'p_membership_id uuid, p_position text, p_jersey_number integer, p_overall_rating integer, p_attributes jsonb, p_image_url text' FROM f
  UNION ALL
  SELECT 10, 'the retired member-table overloads are gone',
         to_regprocedure('public.captain_update_team_member(uuid,text,integer,integer,jsonb,text,text)') IS NULL
         AND to_regprocedure('public.captain_update_team_member(uuid,text,integer,integer,jsonb)') IS NULL
  UNION ALL
  SELECT 11, 'every assigned team captain holds the captain role (or is a dictator)',
         NOT EXISTS (SELECT 1 FROM public.team_registrations r
                     LEFT JOIN public.user_roles ur ON ur.user_id = r.captain_id
                     WHERE ur.role IS DISTINCT FROM 'captain' AND ur.role IS DISTINCT FROM 'dictator')
) c
ORDER BY n;

ROLLBACK;

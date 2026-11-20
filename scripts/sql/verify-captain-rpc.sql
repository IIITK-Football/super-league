-- Read-only checks that the captain roster function is closed and correct on a project. Every row should say
-- passed = t. Run it in the SQL Editor of staging or production after the migrations (it changes nothing: a READ
-- ONLY transaction that is always rolled back). captain_update_roster_player replaced captain_update_team_member when
-- the Freshers member table became season roster memberships (20261124000000, 20261125000000); the retired
-- overloads must be gone. Check 11 reads only a yes or no about captain assignments; 21 and 22 cover the role and assignment helpers (20261201000000). Checks 12-16 cover the dictator roster
-- functions and the roster history guard (20261127000000) and the audit history's write protection (20261126000000).
-- Checks 17-20 cover the account-linked players and verified-email matching (20261130000005-7).
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
  SELECT 11, 'every captain assignment belongs to someone holding the captain role (or a dictator)',
         NOT EXISTS (SELECT 1 FROM public.captain_assignments ca
                     WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = ca.user_id AND ur.role IN ('captain', 'dictator')))
  UNION ALL
  SELECT 12, 'the dictator roster functions exist (new team in a season / save a player / remove an unplayed player / history check)',
         to_regprocedure('public.create_team_in_season(uuid,text)') IS NOT NULL
         AND to_regprocedure('public.update_rostered_player(uuid,text,text,integer,jsonb,integer,text)') IS NOT NULL
         AND to_regprocedure('public.delete_unplayed_player(uuid)') IS NOT NULL
         AND to_regprocedure('public.player_has_match_history(uuid,uuid)') IS NOT NULL
  UNION ALL
  SELECT 13, 'anonymous callers cannot execute the dictator roster functions',
         NOT EXISTS (SELECT 1 FROM unnest(ARRAY['public.create_team_in_season(uuid,text)',
                                                'public.update_rostered_player(uuid,text,text,integer,jsonb,integer,text)',
                                                'public.delete_unplayed_player(uuid)', 'public.player_has_match_history(uuid,uuid)']) sig
                     WHERE to_regprocedure(sig) IS NULL OR has_function_privilege('anon', to_regprocedure(sig), 'EXECUTE'))
  UNION ALL
  SELECT 14, 'signed-in users can call them (each then requires the dictator role)',
         NOT EXISTS (SELECT 1 FROM unnest(ARRAY['public.create_team_in_season(uuid,text)',
                                                'public.update_rostered_player(uuid,text,text,integer,jsonb,integer,text)',
                                                'public.delete_unplayed_player(uuid)']) sig
                     WHERE to_regprocedure(sig) IS NULL OR NOT has_function_privilege('authenticated', to_regprocedure(sig), 'EXECUTE'))
  UNION ALL
  SELECT 15, 'the roster history guard runs before every change or removal of a roster place',
         EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.roster_memberships'::regclass
                   AND t.tgname = 'roster_memberships_keep_history' AND (t.tgtype & 26) = 26 AND t.tgenabled <> 'D')
  UNION ALL
  SELECT 16, 'the audit history exists and nobody but its recorder can write it (signed-in users and the server key included)',
         to_regclass('public.audit_log') IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
                         LEFT JOIN pg_roles r ON r.oid = a.grantee
                         WHERE c.oid = to_regclass('public.audit_log')
                           AND (a.grantee = 0 OR r.rolname IN ('anon', 'authenticated', 'service_role'))
                           AND a.privilege_type NOT IN ('SELECT', 'REFERENCES', 'TRIGGER', 'MAINTAIN'))
  UNION ALL
  SELECT 17, 'the account-link and own-card functions exist and are closed to anonymous callers and PUBLIC; they run as owner with an empty search_path',
         (SELECT bool_and(fn IS NOT NULL AND NOT has_function_privilege('anon', fn, 'EXECUTE') AND has_function_privilege('authenticated', fn, 'EXECUTE')
                          AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
                          AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
          FROM unnest(ARRAY['public.link_player_account(uuid,uuid)', 'public.unlink_player_account(uuid)', 'public.verified_accounts_for_linking(text)',
                            'public.player_link_status(uuid[])', 'public.account_link_matches()', 'public.apply_account_link_matches(jsonb)',
                            'public.dismiss_player_link_key(uuid)', 'public.create_player_for_account(uuid,uuid,text,text,integer,text,integer,jsonb,text)',
                            'public.add_player_to_roster(uuid,uuid,integer,text)', 'public.my_player()', 'public.update_my_player(text,text)']) AS name
          CROSS JOIN LATERAL (SELECT to_regprocedure(name) AS fn) r
          LEFT JOIN pg_proc p ON p.oid = r.fn) IS TRUE
  UNION ALL
  SELECT 18, 'the account link is guarded on every write and unreadable by anonymous visitors and signed-in users',
         EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.players'::regclass AND tgname = 'players_account_link_guard' AND NOT tgisinternal)
         AND NOT has_column_privilege('anon', 'public.players', 'user_id', 'SELECT')
         AND NOT has_column_privilege('authenticated', 'public.players', 'user_id', 'SELECT')
  UNION ALL
  SELECT 19, 'new players need an account and new roster places a linked player; verified accounts are linked to their matching player',
         (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND (tgrelid, tgname) IN (
            ('public.players'::regclass, 'players_require_account'),
            ('public.roster_memberships'::regclass, 'roster_memberships_require_linked_player'),
            ('auth.users'::regclass, 'on_auth_user_verified_link_player'))) = 3
         AND to_regclass('public.player_private_details') IS NULL
  UNION ALL
  SELECT 20, 'private match keys are unreadable by anonymous visitors and signed-in users',
         to_regclass('public.player_link_keys') IS NOT NULL
         AND NOT has_table_privilege('anon', 'public.player_link_keys', 'SELECT')
         AND NOT has_table_privilege('authenticated', 'public.player_link_keys', 'SELECT')
  UNION ALL
  SELECT 21, 'the role and assignment helpers exist and are closed to anonymous callers and PUBLIC',
         (SELECT bool_and(fn IS NOT NULL AND NOT has_function_privilege('anon', fn, 'EXECUTE') AND has_function_privilege('authenticated', fn, 'EXECUTE')
                          AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
          FROM unnest(ARRAY['public.has_role(text)', 'public.my_roles()', 'public.is_captain_of(uuid)', 'public.can_score(uuid)',
                            'public.scorable_match_ids(uuid[])', 'public.season_is_writable(uuid)', 'public.assign_captain(uuid,uuid,boolean)',
                            'public.revoke_captain(uuid)', 'public.assign_scorer(uuid,uuid,uuid,timestamp with time zone)', 'public.revoke_scorer(uuid)',
                            'public.refresh_captain_grants(uuid)']) AS name
          CROSS JOIN LATERAL (SELECT to_regprocedure(name) AS fn) r
          LEFT JOIN pg_proc p ON p.oid = r.fn) IS TRUE
  UNION ALL
  SELECT 22, 'only the four role grants are stored with no stored default or admin role and the old helpers are gone',
         NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role NOT IN ('captain', 'scorer', 'editor', 'dictator'))
         AND to_regprocedure('public.is_role_manager()') IS NULL AND to_regprocedure('public.get_user_role()') IS NULL
) c
ORDER BY n;

ROLLBACK;

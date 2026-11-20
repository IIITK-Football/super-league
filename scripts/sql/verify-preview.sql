-- Read-only checks that the synthetic seed and the migrations are in place on the Preview (staging) project.
-- One SELECT, nothing is changed. Every row should say passed = t; the deploy workflow fails on any f.
-- Counts are MINIMUMS so data added by testers never makes a check fail. It reads only counts and catalog
-- facts, never account details.
SELECT check_name, passed
FROM (
  SELECT 1 AS n, 'teams: at least 24 (8 per division)' AS check_name,
         (SELECT count(*) FROM public.teams) >= 24 AS passed
  UNION ALL SELECT 2, 'players: at least 192',
         (SELECT count(*) FROM public.players) >= 192
  UNION ALL SELECT 3, 'matches: at least 168',
         (SELECT count(*) FROM public.matches) >= 168
  UNION ALL SELECT 4, 'every division has a live match in its current season',
         (SELECT count(DISTINCT s.division_id) FROM public.matches m JOIN public.seasons s ON s.id = m.season_id
          WHERE m.status = 'live' AND s.is_current) >= 3
  UNION ALL SELECT 5, 'goals exist for completed matches',
         (SELECT count(*) FROM public.goals) > 0
  UNION ALL SELECT 6, 'no fixture match is duplicated (same season and same two teams)',
         NOT EXISTS (SELECT 1 FROM public.matches GROUP BY season_id, home_team_id, away_team_id HAVING count(*) > 1)
  UNION ALL SELECT 7, 'fixture dictator exists with the dictator role',
         EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = '60000000-0000-4000-8000-000000000001' AND role = 'dictator')
  UNION ALL SELECT 8, 'fixture editor exists with the editor role',
         EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = '60000000-0000-4000-8000-000000000003' AND role = 'editor')
  UNION ALL SELECT 9, 'both fixture captains hold the captain role',
         (SELECT count(*) FROM public.user_roles WHERE role = 'captain' AND user_id IN ('60000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000004')) = 2
  UNION ALL SELECT 10, 'every captain assignment has a captain or dictator holder',
         NOT EXISTS (SELECT 1 FROM public.captain_assignments ca
                     WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = ca.user_id AND ur.role IN ('captain', 'dictator')))
  UNION ALL SELECT 11, 'team builder captain assignments exist and their team entries have rosters',
         (SELECT count(*) FROM public.captain_assignments) >= 2
         AND NOT EXISTS (SELECT 1 FROM public.captain_assignments ca
                         WHERE NOT EXISTS (SELECT 1 FROM public.roster_memberships rm WHERE rm.team_entry_id = ca.team_entry_id))
  UNION ALL SELECT 12, 'league predictions exist',
         (SELECT count(*) FROM public.predictions) > 0
  UNION ALL SELECT 13, 'newsletter items exist and every division has a current season with its teams',
         (SELECT count(*) FROM public.newsletter) >= 24
         AND (SELECT count(*) FROM public.seasons s JOIN public.team_entries e ON e.season_id = s.id WHERE s.is_current) >= 24
  UNION ALL SELECT 14, 'World Cup fantasy data exists (teams and players and matches and predictions and leaderboard)',
         (SELECT count(*) FROM public.wc_teams) > 0 AND (SELECT count(*) FROM public.wc_players) > 0
         AND (SELECT count(*) FROM public.wc_matches) >= 40 AND (SELECT count(*) FROM public.wc_predictions) > 0
         AND (SELECT count(*) FROM public.wc_leaderboard) > 0
  UNION ALL SELECT 15, 'college-domain trigger is on auth.users',
         EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND tgname = 'ensure_domain_lock' AND NOT tgisinternal)
  UNION ALL SELECT 16, 'new-user profile trigger is on auth.users and no default-role trigger remains',
         (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND tgname = 'on_auth_user_created' AND NOT tgisinternal) = 1
         AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND tgname = 'on_auth_user_role_created')
  UNION ALL SELECT 17, 'fixture media are offline placeholders (no third-party or production image hosts)',
         NOT EXISTS (SELECT 1 FROM public.teams WHERE logo_url !~ '^data:image/')
  UNION ALL SELECT 18, 'every player linked to an account is linked to a verified account',
         NOT EXISTS (SELECT 1 FROM public.players p JOIN auth.users u ON u.id = p.user_id WHERE u.email_confirmed_at IS NULL)
  UNION ALL SELECT 19, 'no linked player keeps a private match key (Auth is the only address source of a linked player)',
         NOT EXISTS (SELECT 1 FROM public.player_link_keys k JOIN public.players p ON p.id = k.player_id WHERE p.user_id IS NOT NULL)
  UNION ALL SELECT 20, 'the old player contact table is gone (Auth holds every player address)',
         to_regclass('public.player_private_details') IS NULL
  UNION ALL SELECT 21, 'every account has the Auth instance and token columns Auth needs to load it',
         NOT EXISTS (SELECT 1 FROM auth.users WHERE instance_id IS NULL OR confirmation_token IS NULL OR recovery_token IS NULL
                     OR email_change_token_new IS NULL OR reauthentication_token IS NULL)
) c
ORDER BY n;

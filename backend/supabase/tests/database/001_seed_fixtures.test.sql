-- Group: database. Verifies the deterministic local seed (supabase/seed.sql).
-- Run: pnpm exec supabase test db --local   (from backend/, local stack only)
BEGIN;
SELECT plan(28);

-- Row volumes (documented in docs/local-seed.md)
SELECT is((SELECT count(*) FROM public.teams)::int, 24, 'teams: 8 per division x 3');
SELECT is((SELECT count(*) FROM public.players)::int, 192, 'players: 8 per team');
SELECT is((SELECT count(*) FROM public.matches)::int, 168, 'matches: 56 per division');
SELECT is((SELECT count(*) FROM public.matches WHERE status = 'live')::int, 3, 'one live match per division');
SELECT is((SELECT count(*) FROM public.matches WHERE status = 'completed')::int, 120, 'completed matches');
SELECT is((SELECT count(*) FROM public.matches WHERE status = 'scheduled')::int, 45, 'scheduled matches');
SELECT cmp_ok((SELECT count(*) FROM public.goals)::int, '>', 400, 'goals seeded');
-- Seed accounts are identified by address, so accounts a developer creates locally while
-- testing sign-in do not change these counts.
CREATE TEMP VIEW seed_users AS
  SELECT id, email FROM auth.users WHERE email ~ '^(lamb|river|diana|sydney|fan[0-9]{2})@iiitkottayam\.ac\.in$';

SELECT is((SELECT count(*) FROM public.user_profiles p JOIN seed_users s ON s.id = p.id)::int, 50, 'profiles: 4 named + 46 fans');
SELECT is((SELECT count(*) FROM seed_users)::int, 50, 'seed auth users match seed profiles');
SELECT is((SELECT count(*) FROM public.newsletter)::int, 24, 'news articles');
SELECT hasnt_table('public', 'polls', 'the unused polls feature is gone');
SELECT is((SELECT count(*) FROM public.team_registrations)::int, 2, 'team registrations');
SELECT results_eq($$SELECT p.first_name::text || ' ' || p.last_name::text, u.email::text, u.email_confirmed_at IS NOT NULL
                    FROM public.players p JOIN auth.users u ON u.id = p.user_id JOIN seed_users s ON s.id = u.id$$,
  $$VALUES ('Jackson Lamb'::text, 'fan01@iiitkottayam.ac.in'::text, true)$$, 'one verified seed account is linked to one player');
SELECT is((SELECT count(*) FROM public.wc_teams)::int, 16, 'World Cup teams');
SELECT is((SELECT count(*) FROM public.wc_matches)::int, 40, 'World Cup matches');
SELECT is((SELECT count(*) FROM public.wc_leaderboard w JOIN seed_users s ON s.id = w.user_id)::int, 50, 'World Cup leaderboard rows');

-- Divisions each have the same shape
SELECT results_eq(
  $$SELECT d.slug, count(*)::int FROM public.team_entries e JOIN public.seasons s ON s.id = e.season_id
    JOIN public.divisions d ON d.id = s.division_id WHERE s.slug = '2026' GROUP BY d.slug ORDER BY d.slug$$,
  $$VALUES ('freshers', 8), ('super-league', 8), ('wsl', 8)$$,
  'eight teams in each division''s 2026 season');

-- Roles are independent grants; a plain account has none (the editor also scores, the Beef's captain also scores one match)
SELECT results_eq(
  $$SELECT r.role, count(*)::int FROM public.user_roles r JOIN seed_users s ON s.id = r.user_id GROUP BY r.role ORDER BY r.role$$,
  $$VALUES ('captain', 2), ('dictator', 1), ('editor', 1), ('scorer', 2)$$,
  'role distribution, and no legacy admin in seed');

-- every assigned captain in the seed holds the captain role (the captain function requires both)
SELECT is((SELECT count(*) FROM public.captain_assignments ca
           WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = ca.user_id AND ur.role IN ('captain', 'dictator')))::int, 0,
          'seed captain assignments all belong to people holding the captain role');
SELECT is((SELECT count(*) FROM public.scorer_assignments sa
           WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = sa.user_id AND ur.role = 'scorer'))::int, 0,
          'seed scorer assignments all belong to people holding the scorer grant');
SELECT is((SELECT count(*) FROM public.user_roles WHERE role = 'default')::int, 0, 'no stored default role');

-- Fixture accounts cannot sign in (no password); seeded ids are stable
SELECT is((SELECT count(*) FROM auth.users u JOIN seed_users s ON s.id = u.id WHERE u.encrypted_password <> '')::int, 0, 'seed accounts have no password');
SELECT is((SELECT id::text FROM auth.users WHERE email = 'lamb@iiitkottayam.ac.in'),
  '60000000-0000-4000-8000-000000000001', 'stable fixture user id');

-- Offline media: no third-party or production image hosts
SELECT is((SELECT count(*) FROM public.teams WHERE logo_url !~ '^data:image/')::int, 0, 'team logos are offline placeholders');
SELECT is((SELECT count(*) FROM public.players WHERE image_url !~ '^data:image/')::int, 0, 'player portraits are offline placeholders');
SELECT is((SELECT count(*) FROM public.wc_teams WHERE logo_url !~ '^data:image/')::int, 0, 'World Cup logos are offline placeholders');
SELECT is((SELECT count(*) FROM public.newsletter WHERE image_url !~ '^data:image/')::int, 0, 'news images are offline placeholders');

-- Referential sanity for goals
SELECT is((SELECT count(*) FROM public.goals g LEFT JOIN public.matches m ON m.id = g.match_id WHERE m.id IS NULL)::int, 0, 'no orphan goals');

SELECT * FROM finish();
ROLLBACK;

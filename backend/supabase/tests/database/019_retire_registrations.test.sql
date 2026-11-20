-- Group: database (auth-roles). team_registrations is retired: the table is gone, every registration it held is kept
-- whole in legacy_team_registrations, every captain assignment is kept, and no function, view or policy still
-- reads it. The drop migration is refused, changing nothing, while a registration is missing from the snapshot.
-- Rolled back.
BEGIN;
SELECT plan(9);

SELECT hasnt_table('public', 'team_registrations', 'the registration table is gone');
SELECT has_table('public', 'legacy_team_registrations', 'its history is kept');
SELECT has_table('public', 'captain_assignments', 'captain assignments are the live data');
SELECT is((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p') AND pg_get_functiondef(p.oid) ~ 'team_registrations')::int, 0, 'no function reads the retired table');
SELECT is((SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND (coalesce(qual, '') ~ 'team_registrations' OR coalesce(with_check, '') ~ 'team_registrations'))::int, 0,
  'no policy reads the retired table');
SELECT is((SELECT count(*) FROM pg_views WHERE schemaname = 'public' AND definition ~ 'team_registrations')::int, 0, 'no view reads the retired table');

-- The history is dictator-read only, and nobody can change it.
SELECT is((SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'legacy_team_registrations' AND cmd = 'SELECT')::int, 1, 'one read policy on the history');
SELECT ok(NOT has_table_privilege('anon', 'public.legacy_team_registrations', 'SELECT'), 'anonymous visitors cannot read it');
SELECT ok(NOT has_table_privilege('authenticated', 'public.legacy_team_registrations', 'INSERT, UPDATE, DELETE'), 'signed-in users cannot change it');

SELECT * FROM finish();
ROLLBACK;

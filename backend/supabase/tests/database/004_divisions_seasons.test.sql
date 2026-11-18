-- Group: database. Divisions, seasons and configurable sections (docs/decisions/D-01-division-season-mapping.md).
-- Runs on the seeded local database inside a transaction that is rolled back.
BEGIN;
SELECT plan(62);

-- Impersonation (same pattern as 003): run one statement as an API role with JWT claims; return the error code.
CREATE FUNCTION pg_temp.exec_as(p_role text, p_uid uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_rows integer;
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN '{}' ELSE json_build_object('sub', p_uid, 'role', p_role)::text END, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  EXECUTE p_sql;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RESET ROLE;
  RETURN 'ok:' || v_rows;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN SQLSTATE;
END;
$$;

CREATE FUNCTION pg_temp.count_as(p_role text, p_uid uuid, p_sql text)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v integer;
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN '{}' ELSE json_build_object('sub', p_uid, 'role', p_role)::text END, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  EXECUTE p_sql INTO v;
  RESET ROLE;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RAISE;
END;
$$;

-- C1: legacy values are ordinary rows; every legacy row is attached; counts are preserved -------------------
SELECT set_eq('SELECT slug FROM public.divisions', ARRAY['super-league', 'wsl', 'freshers'],
  'the three populated legacy values are ordinary division rows');
SELECT set_eq('SELECT legacy_key FROM public.legacy_division_map', ARRAY['mens', 'womens', 'freshers'],
  'each populated legacy value is mapped');
SELECT is((SELECT count(*) FROM public.divisions WHERE slug LIKE '%inter%' OR name ILIKE '%inter%')::int, 0,
  'no Inter division is created from the legacy value');
SELECT is((SELECT count(*) FROM public.seasons)::int, 3, 'one initial season per populated division');
SELECT is((SELECT count(*) FROM public.seasons WHERE is_current AND status = 'active')::int, 3, 'initial seasons are current and active');
SELECT is((SELECT count(*) FROM public.matches WHERE season_id IS NULL)::int, 0, 'every match is attached to a season');
SELECT is((SELECT count(*) FROM public.matches)::int, 168, 'match count is unchanged');
SELECT is((SELECT count(*) FROM public.matches m JOIN public.seasons s ON s.id = m.season_id
           JOIN public.legacy_division_map l ON l.division_id = s.division_id WHERE l.legacy_key = m.division)::int, 168,
  'every match is attached to the season of its own legacy division');
SELECT is((SELECT count(*) FROM public.team_registrations WHERE season_id IS NULL)::int, 0, 'every registration is attached to a season');
SELECT is((SELECT count(*) FROM public.team_entries)::int, (SELECT count(*) FROM public.teams WHERE division IS NOT NULL)::int,
  'every team with a legacy division has exactly one team entry');
SELECT is((SELECT count(*) FROM public.team_entries e JOIN public.teams t ON t.id = e.team_id JOIN public.seasons s ON s.id = e.season_id
           JOIN public.legacy_division_map l ON l.division_id = s.division_id WHERE l.legacy_key <> t.division)::int, 0,
  'team entries match the team''s legacy division');
SELECT is((SELECT count(*) FROM public.season_sections)::int, 3 * (SELECT count(*) FROM public.section_types)::int,
  'each initial season has every section configured');
SELECT is_empty('SELECT * FROM public.division_model_drift()', 'the drift report is empty on the seeded data');

CREATE TEMP TABLE before_counts AS
SELECT (SELECT count(*) FROM public.divisions) AS d, (SELECT count(*) FROM public.seasons) AS s,
       (SELECT count(*) FROM public.team_entries) AS e, (SELECT count(*) FROM public.season_sections) AS ss;
SELECT is(public.backfill_legacy_divisions(),
  '{"divisions_created": 0, "matches_attached": 0, "registrations_attached": 0, "team_entries_created": 0}'::jsonb,
  're-running the backfill changes nothing');
SELECT ok((SELECT d = (SELECT count(*) FROM public.divisions) AND s = (SELECT count(*) FROM public.seasons)
                  AND e = (SELECT count(*) FROM public.team_entries) AND ss = (SELECT count(*) FROM public.season_sections)
           FROM before_counts), 'row counts are identical after the re-run');

-- C2: D-01 season naming and dates -------------------------------------------------------------------------
SELECT is(public.season_label('2026-08-01', '2026-12-03', '2020-01-01'), '2026', 'one calendar year -> "2026"');
SELECT is(public.season_label('2025-09-01', '2026-03-01', '2020-01-01'), '2025–26', 'two consecutive years -> "2025–26"');
SELECT is(public.season_label('2099-09-01', '2100-03-01', '2020-01-01'), '2099–00', 'century boundary keeps two digits');
SELECT is(public.season_label('2024-09-01', '2026-03-01', '2020-01-01'), '2024–2026', 'a longer span uses full years');
SELECT is(public.season_label(NULL, NULL, '2025-11-05'), '2025', 'no matches -> the fallback year');
SELECT is((SELECT s.name FROM public.seasons s JOIN public.divisions d ON d.id = s.division_id WHERE d.slug = 'super-league'),
  public.season_label((SELECT min((date AT TIME ZONE 'Asia/Kolkata')::date) FROM public.matches WHERE division = 'mens'),
                      (SELECT max((date AT TIME ZONE 'Asia/Kolkata')::date) FROM public.matches WHERE division = 'mens'), NULL),
  'the initial season is named from its match dates');
SELECT ok((SELECT s.starts_on = (SELECT min((date AT TIME ZONE 'Asia/Kolkata')::date) FROM public.matches WHERE division = 'womens')
              AND s.ends_on = (SELECT max((date AT TIME ZONE 'Asia/Kolkata')::date) FROM public.matches WHERE division = 'womens')
           FROM public.seasons s JOIN public.divisions d ON d.id = s.division_id WHERE d.slug = 'wsl'),
  'season dates are the first and last match dates');
SELECT is((SELECT s.slug FROM public.seasons s JOIN public.divisions d ON d.id = s.division_id WHERE d.slug = 'freshers'),
  replace((SELECT s.name FROM public.seasons s JOIN public.divisions d ON d.id = s.division_id WHERE d.slug = 'freshers'), '–', '-'),
  'the season slug is the URL form of its name');

-- Rebuild from legacy data only, with no Freshers matches, an `inter` match and an unpopulated value.
SET LOCAL session_replication_role = replica;
DELETE FROM public.season_sections;
DELETE FROM public.team_entries;
UPDATE public.matches SET season_id = NULL;
UPDATE public.team_registrations SET season_id = NULL;
DELETE FROM public.legacy_division_map;
DELETE FROM public.seasons;
DELETE FROM public.divisions;
SET LOCAL session_replication_role = origin;
DELETE FROM public.predictions WHERE match_id IN (SELECT id FROM public.matches WHERE division = 'freshers');
DELETE FROM public.matches WHERE division = 'freshers';
UPDATE public.team_registrations SET created_at = '2025-11-05 10:00+05:30' WHERE division = 'freshers';
INSERT INTO public.matches (id, home_team_id, away_team_id, division, date)
SELECT 'f0000000-0000-4000-8000-000000000001', (SELECT id FROM public.teams WHERE division = 'mens' LIMIT 1),
       (SELECT id FROM public.teams WHERE division = 'mens' OFFSET 1 LIMIT 1), 'inter', '2026-09-09';

SELECT is((public.backfill_legacy_divisions() ->> 'divisions_created')::int, 3, 'the backfill rebuilds from legacy data alone');
SELECT is((SELECT s.name FROM public.seasons s JOIN public.divisions d ON d.id = s.division_id WHERE d.slug = 'freshers'), '2025',
  'a division with no matches is named from its earliest registration');
SELECT ok((SELECT starts_on IS NULL AND ends_on IS NULL FROM public.seasons s JOIN public.divisions d ON d.id = s.division_id WHERE d.slug = 'freshers'),
  'a division with no matches has no season dates');
SELECT is((SELECT count(*) FROM public.divisions)::int, 3, 'an inter match does not create a division');
SELECT results_eq($$SELECT entity, kind FROM public.division_model_drift()$$,
  $$VALUES ('match'::text, 'unmapped_value'::text)$$, 'the inter match is reported as an anomaly, not mapped');
DELETE FROM public.matches WHERE id = 'f0000000-0000-4000-8000-000000000001';

-- C6: legacy writers and new-model writers stay consistent -------------------------------------------------
INSERT INTO public.matches (id, home_team_id, away_team_id, division)
SELECT 'f0000000-0000-4000-8000-000000000002', (SELECT id FROM public.teams WHERE division = 'womens' LIMIT 1),
       (SELECT id FROM public.teams WHERE division = 'womens' OFFSET 1 LIMIT 1), 'womens';
SELECT is((SELECT season_id FROM public.matches WHERE id = 'f0000000-0000-4000-8000-000000000002'),
  (SELECT s.id FROM public.seasons s JOIN public.divisions d ON d.id = s.division_id WHERE d.slug = 'wsl' AND s.is_current),
  'a legacy match insert gets its division''s current season');

INSERT INTO public.matches (id, home_team_id, away_team_id, division)
SELECT 'f0000000-0000-4000-8000-000000000003', (SELECT id FROM public.teams WHERE division = 'womens' LIMIT 1),
       (SELECT id FROM public.teams WHERE division = 'womens' OFFSET 1 LIMIT 1), NULL;
SELECT ok((SELECT season_id IS NULL AND division IS NULL FROM public.matches WHERE id = 'f0000000-0000-4000-8000-000000000003'),
  'a match with no division is left alone (never guessed)');
SELECT results_eq($$SELECT kind FROM public.division_model_drift() WHERE row_id = 'f0000000-0000-4000-8000-000000000003'$$,
  $$VALUES ('no_division'::text)$$, 'a match with no division is reported');
DELETE FROM public.matches WHERE id = 'f0000000-0000-4000-8000-000000000003';

INSERT INTO public.teams (id, name, division) VALUES ('f1000000-0000-4000-8000-000000000001', 'Late Legacy Team', 'mens');
SELECT is((SELECT count(*) FROM public.team_entries e JOIN public.seasons s ON s.id = e.season_id JOIN public.divisions d ON d.id = s.division_id
           WHERE e.team_id = 'f1000000-0000-4000-8000-000000000001' AND d.slug = 'super-league' AND s.is_current)::int, 1,
  'a legacy team insert joins its division''s current season');

-- A dictator-created division with no legacy value, and a second coexisting season of an existing division.
INSERT INTO public.divisions (id, slug, name) VALUES ('f2000000-0000-4000-8000-000000000001', 'inter', 'Inter');
INSERT INTO public.seasons (id, division_id, slug, name) VALUES
  ('f2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001', '2027', '2027');
INSERT INTO public.matches (id, home_team_id, away_team_id, season_id, division)
SELECT 'f0000000-0000-4000-8000-000000000004', (SELECT id FROM public.teams WHERE division = 'mens' LIMIT 1),
       (SELECT id FROM public.teams WHERE division = 'mens' OFFSET 1 LIMIT 1), 'f2000000-0000-4000-8000-000000000002', 'mens';
SELECT is((SELECT division FROM public.matches WHERE id = 'f0000000-0000-4000-8000-000000000004'), NULL::varchar,
  'a match in a new division carries no legacy string (season_id is authoritative, even over the column default)');

INSERT INTO public.seasons (id, division_id, slug, name, status) VALUES
  ('f2000000-0000-4000-8000-000000000003', (SELECT id FROM public.divisions WHERE slug = 'super-league'), '2027', '2027', 'planned');
SELECT is((SELECT count(*) FROM public.seasons s JOIN public.divisions d ON d.id = s.division_id WHERE d.slug = 'super-league')::int, 2,
  'two seasons coexist in one division');
SELECT throws_ok($$INSERT INTO public.seasons (division_id, slug, name, is_current)
                   VALUES ((SELECT id FROM public.divisions WHERE slug = 'super-league'), 'dup', 'Dup', true)$$,
  '23505', NULL, 'at most one season per division is current');
UPDATE public.matches SET season_id = 'f2000000-0000-4000-8000-000000000003' WHERE id = 'f0000000-0000-4000-8000-000000000002';
SELECT is((SELECT division FROM public.matches WHERE id = 'f0000000-0000-4000-8000-000000000002'), 'mens',
  'moving a match to another season re-derives its legacy string');

UPDATE public.team_registrations SET division = 'womens' WHERE id = '70000000-0000-4000-8000-000000000001';
SELECT is((SELECT season_id FROM public.team_registrations WHERE id = '70000000-0000-4000-8000-000000000001'),
  (SELECT s.id FROM public.seasons s JOIN public.divisions d ON d.id = s.division_id WHERE d.slug = 'wsl' AND s.is_current),
  'changing a registration''s division re-derives its season');
SELECT results_eq($$SELECT kind FROM public.division_model_drift() WHERE row_id = '70000000-0000-4000-8000-000000000001'$$,
  $$VALUES ('team_division'::text)$$, 'a registration whose division differs from its team is reported');
UPDATE public.team_registrations SET division = 'freshers' WHERE id = '70000000-0000-4000-8000-000000000001';
SELECT is_empty('SELECT * FROM public.division_model_drift()', 'the drift report is empty again');

-- C5: archiving is distinct from deletion ------------------------------------------------------------------
SELECT throws_ok($$DELETE FROM public.seasons WHERE id = 'f2000000-0000-4000-8000-000000000003'$$, '23503', NULL,
  'a season that has matches cannot be deleted');
SELECT throws_ok($$DELETE FROM public.divisions WHERE slug = 'wsl'$$, '23503', NULL, 'a division that has seasons cannot be deleted');
UPDATE public.seasons SET archived_at = now() WHERE id = 'f2000000-0000-4000-8000-000000000003';
SELECT is((SELECT count(*) FROM public.seasons WHERE id = 'f2000000-0000-4000-8000-000000000003')::int, 1, 'an archived season is kept');

-- C4: no per-division enum or value constraint; World Cup untouched ----------------------------------------
SELECT is((SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
           WHERE n.nspname = 'public' AND t.relname IN ('divisions', 'seasons', 'season_sections', 'team_entries', 'section_types')
             AND c.contype = 'c' AND pg_get_constraintdef(c.oid) ~* '(mens|womens|freshers|inter|super-league|wsl)')::int, 0,
  'no check constraint on the new model names a division');
SELECT is((SELECT count(*) FROM pg_attribute a JOIN pg_class t ON t.oid = a.attrelid JOIN pg_namespace n ON n.oid = t.relnamespace
           JOIN pg_type ty ON ty.oid = a.atttypid
           WHERE n.nspname = 'public' AND t.relname IN ('divisions', 'seasons', 'season_sections', 'team_entries') AND ty.typtype = 'e')::int, 0,
  'the new model uses no enum types');
SELECT is((SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name LIKE 'wc\_%'
           AND column_name IN ('division_id', 'season_id'))::int, 0, 'World Cup tables have no division or season columns');

-- Authorization (database level; the Data API path is covered by backend/tests/divisions) --------------------
INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
SELECT ('c4000000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated',
       (ARRAY['div.dictator', 'div.captain', 'div.editor', 'div.admin', 'div.normal'])[n] || '@iiitkottayam.ac.in', '', now(), now()
FROM generate_series(1, 5) AS n;
UPDATE public.user_roles SET role = 'dictator' WHERE user_id = 'c4000000-0000-4000-8000-000000000001';
UPDATE public.user_roles SET role = 'captain'  WHERE user_id = 'c4000000-0000-4000-8000-000000000002';
UPDATE public.user_roles SET role = 'editor'   WHERE user_id = 'c4000000-0000-4000-8000-000000000003';
UPDATE public.user_roles SET role = 'admin'    WHERE user_id = 'c4000000-0000-4000-8000-000000000004';

SELECT ok(NOT has_function_privilege('anon', 'public.is_dictator()', 'EXECUTE'), 'anon cannot execute is_dictator');
SELECT ok(NOT has_function_privilege('authenticated', 'public.backfill_legacy_divisions()', 'EXECUTE'), 'signed-in users cannot run the backfill');
SELECT ok(NOT has_function_privilege('authenticated', 'public.division_model_drift()', 'EXECUTE'), 'signed-in users cannot run the drift report');
SELECT is((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.prosecdef
             AND p.proname IN ('is_dictator', 'legacy_current_season', 'legacy_key_for_season', 'sync_legacy_division_season',
                               'enter_team_in_legacy_season', 'backfill_legacy_divisions', 'division_model_drift')
             AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c = 'search_path=""'))::int, 0,
  'every new security-definer function pins an empty search_path');

SELECT is(pg_temp.exec_as('authenticated', 'c4000000-0000-4000-8000-000000000001',
  $$INSERT INTO public.divisions (slug, name, visibility) VALUES ('pradhva', 'Pradhva', 'hidden')$$), 'ok:1',
  'a dictator creates a division');
SELECT is(pg_temp.exec_as('authenticated', 'c4000000-0000-4000-8000-000000000001',
  $$UPDATE public.season_sections SET enabled = false WHERE section_key = 'fantasy'
    AND season_id = (SELECT id FROM public.seasons WHERE slug = '2027' AND division_id = (SELECT id FROM public.divisions WHERE slug = 'super-league'))$$),
  'ok:0', 'a dictator may update sections (none exist yet for the new season)');
SELECT is(pg_temp.exec_as('authenticated', 'c4000000-0000-4000-8000-000000000001',
  $$INSERT INTO public.season_sections (season_id, section_key, enabled, settings)
    VALUES ('f2000000-0000-4000-8000-000000000002', 'fantasy', false, '{"note": "off for the first season"}')$$), 'ok:1',
  'a dictator configures a section');
SELECT is(pg_temp.exec_as('authenticated', 'c4000000-0000-4000-8000-000000000002',
  $$INSERT INTO public.divisions (slug, name) VALUES ('by-captain', 'Captain')$$), '42501', 'a captain cannot create a division');
SELECT is(pg_temp.exec_as('authenticated', 'c4000000-0000-4000-8000-000000000003',
  $$INSERT INTO public.seasons (division_id, slug, name) VALUES ('f2000000-0000-4000-8000-000000000001', 'x', 'X')$$), '42501',
  'an editor cannot create a season');
SELECT is(pg_temp.exec_as('authenticated', 'c4000000-0000-4000-8000-000000000004',
  $$INSERT INTO public.divisions (slug, name) VALUES ('by-admin', 'Admin')$$), '42501', 'the legacy admin label grants nothing');
SELECT is(pg_temp.exec_as('authenticated', 'c4000000-0000-4000-8000-000000000005',
  $$UPDATE public.divisions SET name = 'Hacked'$$), 'ok:0', 'a normal user updates no division');
SELECT is(pg_temp.exec_as('anon', NULL, $$INSERT INTO public.divisions (slug, name) VALUES ('by-anon', 'Anon')$$), '42501',
  'anon cannot create a division');
SELECT is(pg_temp.exec_as('authenticated', 'c4000000-0000-4000-8000-000000000001',
  $$INSERT INTO public.legacy_division_map (legacy_key, division_id, initial_season_id)
    VALUES ('inter', 'f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000002')$$), '42501',
  'not even a dictator writes the legacy map');

SELECT is(pg_temp.count_as('anon', NULL, $$SELECT count(*) FROM public.divisions WHERE slug = 'pradhva'$$), 0,
  'anon cannot see a hidden division');
SELECT is(pg_temp.count_as('authenticated', 'c4000000-0000-4000-8000-000000000005',
  $$SELECT count(*) FROM public.seasons WHERE id = 'f2000000-0000-4000-8000-000000000003'$$), 0,
  'a normal user cannot see an archived season');
SELECT is(pg_temp.count_as('authenticated', 'c4000000-0000-4000-8000-000000000001',
  $$SELECT count(*) FROM public.seasons WHERE id = 'f2000000-0000-4000-8000-000000000003'$$), 1,
  'a dictator sees an archived season');
SELECT is(pg_temp.count_as('anon', NULL, $$SELECT count(*) FROM public.seasons s JOIN public.divisions d ON d.id = s.division_id
  WHERE d.slug IN ('super-league', 'wsl', 'freshers', 'inter')$$), 4,
  'anon sees the public, unarchived seasons (three initial seasons and Inter 2027)');

SELECT * FROM finish();
ROLLBACK;

-- Group: database. A captain writes only through a roster place on the exact team entry and season they are assigned
-- to: the shared FUT card change shows on every roster place of that player (and is audited with the captain as
-- actor), jersey and position stay on the captain's own place, and writing through another team's place changes
-- nothing. A dictator who is also a captain keeps dictator scope. Ratings stay unset until entered: no default, no
-- 50, NULL can be saved and cleared, and an out-of-range rating is refused. Rolled back.
BEGIN;
SELECT plan(16);
-- Captain fixtures are written as registrations (who captains which team in which season) and turned into the
-- team entries' captain assignments, which is what the roster function reads.
CREATE TEMP TABLE _registrations (id uuid DEFAULT gen_random_uuid(), captain_id uuid, team_name text, season_id uuid, team_id uuid) ON COMMIT DROP;

-- Two current seasons in two divisions, a team in each, and one player on both rosters (one shared card).
INSERT INTO public.divisions (id, slug, name, visibility) VALUES ('c1d00000-0000-4000-8000-000000000001', 'cs-a', 'Scope A', 'public'), ('c1d00000-0000-4000-8000-000000000002', 'cs-b', 'Scope B', 'public');
INSERT INTO public.seasons (id, division_id, slug, name, is_current, visibility) VALUES
  ('c1500000-0000-4000-8000-000000000001', 'c1d00000-0000-4000-8000-000000000001', '2026', 'Scope A 2026', true, 'public'),
  ('c1500000-0000-4000-8000-000000000002', 'c1d00000-0000-4000-8000-000000000002', '2026', 'Scope B 2026', true, 'public');
INSERT INTO public.teams (id, name) VALUES ('c1700000-0000-4000-8000-000000000001', 'Scope Reds'), ('c1700000-0000-4000-8000-000000000002', 'Scope Blues');
INSERT INTO public.team_entries (id, team_id, season_id) VALUES
  ('c1e00000-0000-4000-8000-000000000001', 'c1700000-0000-4000-8000-000000000001', 'c1500000-0000-4000-8000-000000000001'),
  ('c1e00000-0000-4000-8000-000000000002', 'c1700000-0000-4000-8000-000000000002', 'c1500000-0000-4000-8000-000000000002');
INSERT INTO public.players (id, first_name, last_name, overall_rating) VALUES
  ('c1900000-0000-4000-8000-000000000001', 'Shared', 'Card', 60),
  ('c1900000-0000-4000-8000-000000000002', 'Only', 'Blue', 61);
INSERT INTO public.roster_memberships (id, player_id, team_entry_id, season_id, jersey_number) VALUES
  ('c1a00000-0000-4000-8000-000000000001', 'c1900000-0000-4000-8000-000000000001', 'c1e00000-0000-4000-8000-000000000001', 'c1500000-0000-4000-8000-000000000001', 5),
  ('c1a00000-0000-4000-8000-000000000002', 'c1900000-0000-4000-8000-000000000001', 'c1e00000-0000-4000-8000-000000000002', 'c1500000-0000-4000-8000-000000000002', 6),
  ('c1a00000-0000-4000-8000-000000000003', 'c1900000-0000-4000-8000-000000000002', 'c1e00000-0000-4000-8000-000000000002', 'c1500000-0000-4000-8000-000000000002', 7);
-- Captain of Scope Reds (a captain), and a dictator who captains Scope Blues.
INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
SELECT ('c1b00000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated', (ARRAY['cs.captain','cs.boss'])[n] || '@iiitkottayam.ac.in', '', now(), now()
FROM generate_series(1, 2) AS n;
INSERT INTO public.user_roles (user_id, role) SELECT id, 'captain' FROM auth.users WHERE id = 'c1b00000-0000-4000-8000-000000000001' ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role) SELECT id, 'dictator' FROM auth.users WHERE id = 'c1b00000-0000-4000-8000-000000000002' ON CONFLICT DO NOTHING;
INSERT INTO _registrations (captain_id, team_name, season_id, team_id) VALUES
  ('c1b00000-0000-4000-8000-000000000001', 'Scope Reds', 'c1500000-0000-4000-8000-000000000001', 'c1700000-0000-4000-8000-000000000001'),
  ('c1b00000-0000-4000-8000-000000000002', 'Scope Blues', 'c1500000-0000-4000-8000-000000000002', 'c1700000-0000-4000-8000-000000000002');
INSERT INTO public.captain_assignments (team_entry_id, user_id)
SELECT e.id, r.captain_id FROM _registrations r JOIN public.team_entries e ON e.team_id = r.team_id AND e.season_id = r.season_id
ON CONFLICT (team_entry_id) DO NOTHING;

CREATE FUNCTION pg_temp.as_user(p_n integer, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ('c1b00000-0000-4000-8000-00000000000' || p_n)::uuid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', ('c1b00000-0000-4000-8000-00000000000' || p_n), true);
  SET LOCAL ROLE authenticated;
  EXECUTE p_sql INTO v;
  RESET ROLE;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RAISE;
END;
$$;
CREATE FUNCTION pg_temp.save(p_n integer, p_place text, p_rating text, p_jersey integer DEFAULT NULL, p_attributes text DEFAULT '{}')
RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.as_user(p_n, format('SELECT public.captain_update_roster_player(%L, NULL, %s, %s, %L::jsonb, NULL)::text',
    p_place, coalesce(p_jersey::text, 'NULL'), p_rating, p_attributes));
$$;

-- Shared card -----------------------------------------------------------------------------------------------------
SELECT lives_ok($$SELECT pg_temp.save(1, 'c1a00000-0000-4000-8000-000000000001', '77', 5, '{"stats": {"Pace": {"total": 80}}}')$$,
  'a captain saves the shared card through their own team''s roster place');
SELECT results_eq($$SELECT p.overall_rating, p.attributes FROM public.roster_memberships m JOIN public.players p ON p.id = m.player_id
                    WHERE m.id = 'c1a00000-0000-4000-8000-000000000002'$$,
  $$VALUES (77, '{"stats": {"Pace": {"total": 80}}}'::jsonb)$$, 'the card change shows on the player''s other team''s roster place');
SELECT is((SELECT actor_id FROM public.audit_log WHERE table_name = 'players' AND record_id = 'c1900000-0000-4000-8000-000000000001' ORDER BY id DESC LIMIT 1),
  'c1b00000-0000-4000-8000-000000000001'::uuid, 'the card change is audited with the captain as actor');

-- Season fields stay local -----------------------------------------------------------------------------------------
SELECT lives_ok($$SELECT pg_temp.save(1, 'c1a00000-0000-4000-8000-000000000001', '77', 9, '{"stats": {"Pace": {"total": 80}}}')$$, 'the captain changes the jersey on their own place');
SELECT results_eq($$SELECT jersey_number FROM public.roster_memberships WHERE id IN ('c1a00000-0000-4000-8000-000000000001', 'c1a00000-0000-4000-8000-000000000002') ORDER BY id$$,
  $$VALUES (9), (6)$$, 'only the captain''s own roster place changed; the other team''s jersey is untouched');

-- No writes through another team -----------------------------------------------------------------------------------
SELECT throws_ok($$SELECT pg_temp.save(1, 'c1a00000-0000-4000-8000-000000000002', '20', 1, '{}')$$,
  'P0001', 'Player is not part of your assigned roster', 'the same player through another team''s place is refused');
SELECT throws_ok($$SELECT pg_temp.save(1, 'c1a00000-0000-4000-8000-000000000003', '20', 1, '{}')$$,
  'P0001', 'Player is not part of your assigned roster', 'another team''s player is refused');
SELECT results_eq($$SELECT p.overall_rating, m.jersey_number FROM public.roster_memberships m JOIN public.players p ON p.id = m.player_id
                    WHERE m.id IN ('c1a00000-0000-4000-8000-000000000002', 'c1a00000-0000-4000-8000-000000000003') ORDER BY m.id$$,
  $$VALUES (77, 6), (61, 7)$$, 'and nothing changed');

-- Dictator who is also a captain ------------------------------------------------------------------------------------
SELECT lives_ok($$SELECT pg_temp.save(2, 'c1a00000-0000-4000-8000-000000000001', '78', 9, '{}')$$, 'a dictator who captains another team still edits any team');

-- Ratings stay unset until entered -----------------------------------------------------------------------------------
SELECT lives_ok($$SELECT pg_temp.save(1, 'c1a00000-0000-4000-8000-000000000001', 'NULL', 9, '{}')$$, 'a captain may save with the rating not set');
SELECT is((SELECT overall_rating FROM public.players WHERE id = 'c1900000-0000-4000-8000-000000000001'), NULL::integer, 'and it stays not set');
SELECT set_config('request.jwt.claims', '', true); -- a fixture written as the seed writes it
INSERT INTO public.players (id, first_name, last_name) VALUES ('c1900000-0000-4000-8000-000000000003', 'No', 'Rating');
INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES ('c1b00000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'cs.fresh@iiitkottayam.ac.in', '', now(), now(), now());
SELECT is((SELECT overall_rating FROM public.players WHERE id = 'c1900000-0000-4000-8000-000000000003'), NULL::integer, 'a new player row has no rating by default');
SELECT is(pg_temp.as_user(2, $q$SELECT overall_rating::text FROM public.players WHERE id = (SELECT public.create_player_for_account('c1b00000-0000-4000-8000-000000000009', 'c1e00000-0000-4000-8000-000000000001', 'Fresh', 'Face'))$q$),
  NULL, 'a player created without a rating has none (no 50)');
SELECT lives_ok($$SELECT pg_temp.as_user(2, $q$SELECT public.update_rostered_player('c1a00000-0000-4000-8000-000000000003', 'Only', 'Blue', NULL, '{}', 7, NULL)::text$q$)$$,
  'a dictator clears a rating');
SELECT is((SELECT overall_rating FROM public.players WHERE id = 'c1900000-0000-4000-8000-000000000002'), NULL::integer, 'the cleared rating is not set');
SELECT throws_ok($$UPDATE public.players SET overall_rating = 100 WHERE id = 'c1900000-0000-4000-8000-000000000002'$$, '23514', NULL, 'a rating above 99 is refused');

SELECT * FROM finish();
ROLLBACK;

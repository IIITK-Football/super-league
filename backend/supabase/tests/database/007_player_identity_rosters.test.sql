-- Group: database. Player identity and season rosters: one reusable identity (the FUT card) per person, a roster
-- membership per season, private match keys reachable only through dictator functions, history that cannot be erased by deleting a player,
-- season statistics derived from match events (never stored on the identity or membership), and access by role.
-- Rolled back.
BEGIN;
SELECT plan(55);

INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
SELECT ('b7000000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated',
       (ARRAY['r.normal','r.captain','r.editor','r.admin','r.dictator'])[n] || '@iiitkottayam.ac.in', '', now(), now()
FROM generate_series(1, 5) AS n;
UPDATE public.user_roles SET role = 'captain'  WHERE user_id = 'b7000000-0000-4000-8000-000000000002';
UPDATE public.user_roles SET role = 'editor'   WHERE user_id = 'b7000000-0000-4000-8000-000000000003';
UPDATE public.user_roles SET role = 'default'    WHERE user_id = 'b7000000-0000-4000-8000-000000000004';
UPDATE public.user_roles SET role = 'dictator' WHERE user_id = 'b7000000-0000-4000-8000-000000000005';

-- The captain holds the registration of a seeded Super League team for its season.
CREATE TEMP TABLE _fx AS
SELECT e.id AS entry_id, e.team_id, e.season_id,
       (SELECT e2.id FROM public.team_entries e2 WHERE e2.season_id = e.season_id AND e2.id <> e.id ORDER BY e2.id LIMIT 1) AS other_entry_id,
       (SELECT rm.id FROM public.roster_memberships rm WHERE rm.team_entry_id = e.id ORDER BY rm.jersey_number LIMIT 1) AS membership_id,
       (SELECT rm.player_id FROM public.roster_memberships rm WHERE rm.team_entry_id = e.id ORDER BY rm.jersey_number LIMIT 1) AS player_id
FROM public.team_entries e JOIN public.seasons s ON s.id = e.season_id JOIN public.divisions d ON d.id = s.division_id
WHERE d.slug = 'super-league' ORDER BY e.id LIMIT 1;
INSERT INTO public.team_registrations (captain_id, team_name, season_id, team_id)
SELECT 'b7000000-0000-4000-8000-000000000002', 'Roster captain team', season_id, team_id FROM _fx;
GRANT SELECT ON _fx TO anon, authenticated;

-- Runs a statement as an API role and returns the integer it yields (row count for writes).
CREATE FUNCTION pg_temp.as_user(p_n integer, p_sql text)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v integer;
  v_uid uuid := CASE WHEN p_n IS NULL THEN NULL ELSE ('b7000000-0000-4000-8000-00000000000' || p_n)::uuid END;
  v_role text := CASE WHEN p_n IS NULL THEN 'anon' ELSE 'authenticated' END;
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN v_uid IS NULL THEN '{}' ELSE json_build_object('sub', v_uid, 'role', v_role)::text END, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_uid::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', v_role);
  IF p_sql ~* '^\s*select' THEN
    EXECUTE p_sql INTO v;
  ELSE
    EXECUTE p_sql;
    GET DIAGNOSTICS v = ROW_COUNT;
  END IF;
  RESET ROLE;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RAISE;
END;
$$;

-- Schema ------------------------------------------------------------------------------------------------------
SELECT has_table('public', 'roster_memberships', 'season roster memberships exist');
SELECT has_table('public', 'player_link_keys', 'private match keys exist (the contact-email table is gone)');
SELECT has_table('public', 'legacy_roster_map', 'the Freshers member mapping is recorded');
SELECT has_table('public', 'legacy_player_assist_counts', 'the retired assists counter is snapshotted');
SELECT hasnt_column('public', 'players', 'goals', 'the identity stores no goals');
SELECT hasnt_column('public', 'roster_memberships', 'goals', 'a membership stores no goals');
SELECT hasnt_column('public', 'roster_memberships', 'assists', 'a membership stores no assists');
SELECT hasnt_column('public', 'players', 'email', 'the identity has no public email column');
-- The team-bound roster is retired (20261125000000).
SELECT hasnt_table('public', 'team_members', 'the separate Freshers member table is gone');
SELECT hasnt_column('public', 'players', 'team_id', 'a player is not bound to a team');
SELECT hasnt_column('public', 'players', 'team_entry_id', 'a player is not bound to one season');
SELECT hasnt_column('public', 'players', 'jersey_number', 'the jersey number belongs to the roster place');
SELECT hasnt_column('public', 'players', 'position', 'the position belongs to the roster place');
SELECT hasnt_column('public', 'players', 'assists', 'no cross-season assists counter on the identity');
SELECT hasnt_function('public', 'captain_update_team_member', 'the member-table RPC is retired (both overloads)');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.roster_memberships'::regclass), 'memberships have row level security');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.player_link_keys'::regclass), 'match keys have row level security');

-- Constraints -------------------------------------------------------------------------------------------------
SELECT throws_ok($$INSERT INTO public.roster_memberships (player_id, team_entry_id, season_id)
                   SELECT player_id, other_entry_id, season_id FROM _fx$$, '23505', NULL,
  'a player is on one team per season');
SELECT throws_ok($$INSERT INTO public.players (id, first_name, last_name) VALUES ('b7100000-0000-4000-8000-000000000001', 'Jersey', 'Clash');
                   INSERT INTO public.roster_memberships (player_id, team_entry_id, season_id, jersey_number)
                   SELECT 'b7100000-0000-4000-8000-000000000001', entry_id, season_id,
                          (SELECT jersey_number FROM public.roster_memberships WHERE id = _fx.membership_id) FROM _fx$$, '23505', NULL,
  'a jersey number is unique within a team entry');
SELECT throws_ok($$INSERT INTO public.roster_memberships (player_id, team_entry_id, season_id)
                   SELECT player_id, entry_id, (SELECT id FROM public.seasons WHERE id <> _fx.season_id LIMIT 1) FROM _fx$$, '23503', NULL,
  'a membership''s season must be its team entry''s season');
SELECT throws_ok($$DELETE FROM public.players WHERE id = (SELECT player_id FROM _fx)$$, '23503', NULL,
  'a player on a roster cannot be deleted (history is kept)');
SELECT is((SELECT confdeltype FROM pg_constraint WHERE conname = 'goals_player_id_fkey')::text, 'r',
  'deleting a player who scored is refused instead of deleting the goals');
SELECT is((SELECT confdeltype FROM pg_constraint WHERE conname = 'goals_assist_id_fkey')::text, 'r',
  'deleting a player who assisted is refused instead of clearing the assist');
SELECT throws_ok($$DELETE FROM public.roster_memberships
                   WHERE (player_id, season_id) IN (SELECT player_id, season_id FROM public.season_player_stats WHERE goals > 0 LIMIT 1)$$,
  '23503', 'This player has goals or assists this season, so their place on the roster is kept',
  'a roster place with goals in that season cannot be removed, whoever asks');
SELECT lives_ok($$INSERT INTO public.players (id, first_name, last_name) VALUES
                   ('b7100000-0000-4000-8000-000000000002', 'Unlinked', 'One'), ('b7100000-0000-4000-8000-000000000003', 'Unlinked', 'Two')$$,
  'players without an account or roster are valid');

-- The same person across seasons: one identity --------------------------------------------------------------
SELECT ok((SELECT count(*) FROM public.roster_memberships GROUP BY player_id ORDER BY count(*) DESC LIMIT 1) >= 2,
  'the seed has one identity on rosters in two seasons');
SELECT is((SELECT count(DISTINCT s.division_id) FROM public.roster_memberships rm JOIN public.seasons s ON s.id = rm.season_id
           WHERE rm.player_id = (SELECT player_id FROM public.roster_memberships GROUP BY player_id ORDER BY count(*) DESC LIMIT 1))::int, 2,
  'that identity plays in two divisions');

-- Season statistics are per season, with the club of that season's roster place -------------------------------
INSERT INTO public.goals (match_id, player_id, team_id, minute, is_own_goal)
SELECT m.id, x.player_id, te.team_id, '10', false
FROM (SELECT player_id FROM public.roster_memberships GROUP BY player_id ORDER BY count(*) DESC LIMIT 1) x
JOIN public.roster_memberships rm ON rm.player_id = x.player_id
JOIN public.team_entries te ON te.id = rm.team_entry_id
JOIN LATERAL (SELECT id FROM public.matches WHERE season_id = rm.season_id ORDER BY id LIMIT 1) m ON true;
SELECT is((SELECT count(DISTINCT club) FROM public.season_player_stats
           WHERE player_id = (SELECT player_id FROM public.roster_memberships GROUP BY player_id ORDER BY count(*) DESC LIMIT 1))::int, 2,
  'the player''s line in each season names that season''s club');
SELECT ok((SELECT bool_and(sps.club = t.name) FROM public.season_player_stats sps
           JOIN public.roster_memberships rm ON rm.player_id = sps.player_id AND rm.season_id = sps.season_id
           JOIN public.team_entries te ON te.id = rm.team_entry_id JOIN public.teams t ON t.id = te.team_id),
  'every stat line''s club is the roster place of that season');
-- Until the canonical event model, a match records goals in the goals table and in its JSON: per match and player
-- the greater count is used, so a duplicated record counts once and a JSON-only goal (Freshers) still counts.
CREATE TEMP TABLE _st AS
SELECT rm.player_id, rm.season_id, (SELECT id FROM public.matches WHERE season_id = rm.season_id ORDER BY id DESC LIMIT 1) AS match_id
FROM public.roster_memberships rm WHERE rm.player_id = (SELECT player_id FROM public.roster_memberships rm2
  WHERE NOT EXISTS (SELECT 1 FROM public.goals g WHERE g.player_id = rm2.player_id OR g.assist_id = rm2.player_id)
  GROUP BY player_id ORDER BY player_id LIMIT 1);
UPDATE public.matches SET scorers = COALESCE(scorers, '[]'::jsonb) || jsonb_build_array((SELECT player_id::text FROM _st))
WHERE id = (SELECT match_id FROM _st);
SELECT is((SELECT goals FROM public.season_player_stats WHERE player_id = (SELECT player_id FROM _st) AND season_id = (SELECT season_id FROM _st)), 1,
  'a goal listed only in the match JSON counts');
INSERT INTO public.goals (match_id, player_id, team_id, minute, is_own_goal)
SELECT match_id, player_id, (SELECT te.team_id FROM public.roster_memberships rm JOIN public.team_entries te ON te.id = rm.team_entry_id
                             WHERE rm.player_id = _st.player_id AND rm.season_id = _st.season_id), '20', false FROM _st;
SELECT is((SELECT goals FROM public.season_player_stats WHERE player_id = (SELECT player_id FROM _st) AND season_id = (SELECT season_id FROM _st)), 1,
  'the same goal recorded in both places counts once');
UPDATE public.matches SET assists = COALESCE(assists, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('player_id', (SELECT player_id::text FROM _st)))
WHERE id = (SELECT match_id FROM _st);
SELECT is((SELECT assists FROM public.season_player_stats WHERE player_id = (SELECT player_id FROM _st) AND season_id = (SELECT season_id FROM _st)), 1,
  'an assist listed as a {"player_id"} object counts');

-- Access: reading ---------------------------------------------------------------------------------------------
SELECT is(pg_temp.as_user(NULL, 'SELECT count(*) FROM public.players'), (SELECT count(*)::int FROM public.players), 'anyone can read player cards');
SELECT ok(pg_temp.as_user(NULL, 'SELECT count(*) FROM public.roster_memberships') > 0, 'anyone can read public season rosters');
SELECT throws_ok($$SELECT pg_temp.as_user(NULL, 'SELECT count(*) FROM public.player_link_keys')$$, '42501', NULL, 'anon cannot read match keys directly');
SELECT throws_ok($$SELECT pg_temp.as_user(1, 'SELECT count(*) FROM public.player_link_keys')$$, '42501', NULL, 'a normal user cannot read match keys directly');
SELECT throws_ok($$SELECT pg_temp.as_user(2, 'SELECT count(*) FROM public.player_link_keys')$$, '42501', NULL, 'a captain cannot read match keys directly');
SELECT throws_ok($$SELECT pg_temp.as_user(3, 'SELECT count(*) FROM public.player_link_keys')$$, '42501', NULL, 'an editor cannot read match keys directly');
SELECT throws_ok($$SELECT pg_temp.as_user(4, 'SELECT count(*) FROM public.player_link_keys')$$, '42501', NULL, 'a former legacy admin cannot read match keys directly');
SELECT throws_ok($$SELECT pg_temp.as_user(5, 'SELECT count(*) FROM public.player_link_keys')$$, '42501', NULL, 'even a dictator (only through the matching functions) cannot read match keys directly');
SELECT is(pg_temp.as_user(2, 'SELECT count(*) FROM public.legacy_roster_map'), 0, 'only dictators read the roster mapping');

-- Access: writing ---------------------------------------------------------------------------------------------
SELECT throws_ok($$SELECT pg_temp.as_user(1, $q$INSERT INTO public.players (first_name, last_name) VALUES ('Fake', 'Player')$q$)$$, '42501', NULL,
  'a normal user cannot create a player');
SELECT throws_ok($$SELECT pg_temp.as_user(2, $q$INSERT INTO public.players (first_name, last_name) VALUES ('Fake', 'Player')$q$)$$, '42501', NULL,
  'a captain cannot create a player');
SELECT throws_ok($$SELECT pg_temp.as_user(4, $q$INSERT INTO public.players (first_name, last_name) VALUES ('Fake', 'Player')$q$)$$, '42501', NULL,
  'a former legacy admin, now an ordinary user, cannot create a player');
SELECT is(pg_temp.as_user(2, $q$UPDATE public.players SET first_name = 'Renamed' WHERE id = (SELECT player_id FROM _fx)$q$), 0,
  'a captain cannot rename their own player directly');
SELECT is(pg_temp.as_user(2, $q$DELETE FROM public.roster_memberships WHERE id = (SELECT membership_id FROM _fx)$q$), 0,
  'a captain cannot remove a player from their roster');
SELECT throws_ok($$SELECT pg_temp.as_user(2, $q$INSERT INTO public.roster_memberships (player_id, team_entry_id, season_id)
                   SELECT 'b7100000-0000-4000-8000-000000000002', entry_id, season_id FROM _fx$q$)$$, NULL, NULL,
  'a captain cannot add a player to their roster');
SELECT is(pg_temp.as_user(3, $q$UPDATE public.roster_memberships SET jersey_number = 98 WHERE id = (SELECT membership_id FROM _fx)$q$), 0,
  'an editor cannot change a roster');
SELECT throws_ok($$SELECT pg_temp.as_user(NULL, $q$UPDATE public.players SET first_name = 'Anon' WHERE id = (SELECT player_id FROM _fx)$q$)$$, '42501', NULL,
  'anon cannot write players');
SELECT is(pg_temp.as_user(5, $q$UPDATE public.players SET first_name = 'Edited' WHERE id = (SELECT player_id FROM _fx)$q$), 1,
  'a dictator edits a player');
SELECT throws_ok($$SELECT pg_temp.as_user(5, $q$INSERT INTO public.player_link_keys (player_id, email)
                              SELECT 'b7100000-0000-4000-8000-000000000002', 'unlinked.one@iiitkottayam.ac.in'$q$)$$, '42501', NULL,
  'a dictator cannot write a match key directly');

-- create_player_for_account (the only creator) ------------------------------------------------------------------
INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES ('b7000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'r.newplayer@iiitkottayam.ac.in', '', now(), now(), now());
SELECT ok(pg_temp.as_user(5, $q$SELECT count(*) FROM (SELECT public.create_player_for_account('b7000000-0000-4000-8000-000000000006', entry_id, 'Dictator', 'Made', 77, 'ST', 60) FROM _fx) x$q$) = 1,
  'a dictator creates a player for a verified account on a season roster in one step');
SELECT results_eq($$SELECT rm.jersey_number, rm.position, p.user_id FROM public.players p
                    JOIN public.roster_memberships rm ON rm.player_id = p.id
                    WHERE p.first_name = 'Dictator' AND p.last_name = 'Made'$$,
  $$VALUES (77, 'ST'::text, 'b7000000-0000-4000-8000-000000000006'::uuid)$$, 'the new player has its roster place and its account');
SELECT throws_ok($$SELECT pg_temp.as_user(2, $q$SELECT count(*) FROM (SELECT public.create_player_for_account('b7000000-0000-4000-8000-000000000006', entry_id, 'Captain', 'Made') FROM _fx) x$q$)$$,
  '42501', 'Only a dictator can create players', 'a captain cannot create a player through the function');
SELECT throws_ok($$SELECT pg_temp.as_user(NULL, $q$SELECT count(*) FROM (SELECT public.create_player_for_account('b7000000-0000-4000-8000-000000000006', entry_id, 'Anon', 'Made') FROM _fx) x$q$)$$,
  '42501', NULL, 'anon cannot call the function');

SELECT * FROM finish();
ROLLBACK;

-- Group: database. Captain roster edits. captain_update_roster_player (which replaced captain_update_team_member when
-- the Freshers member table became season roster memberships) may be used only by
--   * a captain: holding the team's registration for that season AND the captain role, or
--   * a dictator (any team).
-- It writes only the SL-003 allow-list: position and jersey number on the season roster place; overall rating,
-- attributes/play styles and portrait on the player's card. Never a name, email, account link or the roster itself.
-- It pins its search_path; anonymous callers and PUBLIC cannot execute it. Roles follow
-- docs/decisions/SL-003-role-capability-matrix.md. Editor and normal users (including a former legacy admin, now an ordinary user) are tested.
BEGIN;
SELECT plan(40);

-- Fixtures -------------------------------------------------------------------------------------------------
INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
SELECT ('c0000000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated',
       (ARRAY['captain.a','captain.b','dictator','normal','editor','legacyadmin','assigned.norole','unassigned.captain'])[n]
         || '@iiitkottayam.ac.in', '', now(), now()
FROM generate_series(1, 8) AS n;

UPDATE public.user_roles SET role = 'captain'  WHERE user_id IN ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
                                                                 'c0000000-0000-4000-8000-000000000008');
UPDATE public.user_roles SET role = 'dictator' WHERE user_id = 'c0000000-0000-4000-8000-000000000003';
UPDATE public.user_roles SET role = 'editor'   WHERE user_id = 'c0000000-0000-4000-8000-000000000005';
UPDATE public.user_roles SET role = 'default'    WHERE user_id = 'c0000000-0000-4000-8000-000000000006';
-- user 4 (normal) and user 7 (assigned.norole) keep the default role

CREATE TEMP TABLE _season AS
SELECT s.id FROM public.seasons s JOIN public.divisions d ON d.id = s.division_id WHERE d.slug = 'freshers' AND s.is_current;
-- A second season of the same division, to prove the assignment is per season.
INSERT INTO public.seasons (id, division_id, slug, name)
SELECT 'f9000000-0000-4000-8000-000000000001', s.division_id, 'rpc-other', 'RPC other season'
FROM public.seasons s WHERE s.id = (SELECT id FROM _season);

INSERT INTO public.teams (id, name) VALUES
  ('f0000000-0000-4000-8000-000000000001', 'RPC Team A'),
  ('f0000000-0000-4000-8000-000000000002', 'RPC Team B'),
  ('f0000000-0000-4000-8000-000000000003', 'RPC Team C');
INSERT INTO public.team_entries (id, team_id, season_id) VALUES
  ('f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', (SELECT id FROM _season)),
  ('f1000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000002', (SELECT id FROM _season)),
  ('f1000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000003', (SELECT id FROM _season)),
  ('f1000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000001');

INSERT INTO public.team_registrations (id, captain_id, team_name, season_id, team_id) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'RPC Team A', (SELECT id FROM _season), 'f0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'RPC Team B', (SELECT id FROM _season), 'f0000000-0000-4000-8000-000000000002'),
  ('d0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000007', 'RPC Team C', (SELECT id FROM _season), 'f0000000-0000-4000-8000-000000000003');

INSERT INTO public.players (id, first_name, last_name, overall_rating, attributes, image_url) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'Player', 'A', 60, '{}', 'old-a'),
  ('e0000000-0000-4000-8000-000000000002', 'Player', 'B', 55, '{}', 'old-b'),
  ('e0000000-0000-4000-8000-000000000003', 'Player', 'C', 50, '{}', 'old-c'),
  ('e0000000-0000-4000-8000-000000000004', 'Player', 'D', 50, '{}', 'old-d');
INSERT INTO public.player_private_details (player_id, email) VALUES ('e0000000-0000-4000-8000-000000000001', 'player.a@iiitkottayam.ac.in');
INSERT INTO public.roster_memberships (id, player_id, team_entry_id, season_id, jersey_number, position) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', (SELECT id FROM _season), 7, 'CM'),
  ('a1000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', (SELECT id FROM _season), 4, 'CB'),
  ('a1000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000003', (SELECT id FROM _season), 1, 'GK'),
  ('a1000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000001', (SELECT id FROM _season), 10, 'ST'),
  -- Team A in another season: captain A's registration is for the current season only.
  ('a1000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000004', 'f9000000-0000-4000-8000-000000000001', 5, 'CB');

-- Calls the RPC the way the API does: switch to an API role and set the JWT claims, then switch back.
CREATE FUNCTION pg_temp.call_as(p_role text, p_uid uuid, p_membership uuid, p_position text, p_jersey integer,
                                p_rating integer, p_attrs jsonb, p_image text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN '{}' ELSE json_build_object('sub', p_uid, 'role', p_role)::text END, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  PERFORM public.captain_update_roster_player(p_membership, p_position, p_jersey, p_rating, p_attrs, p_image);
  RESET ROLE;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RAISE;
END;
$$;

-- Privileges and settings ----------------------------------------------------------------------------------
SELECT ok(NOT has_function_privilege('anon', 'public.captain_update_roster_player(uuid,text,integer,integer,jsonb,text)', 'EXECUTE'),
  'anon cannot execute');
SELECT ok(
  (SELECT p.proacl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
   FROM pg_proc p WHERE p.oid = 'public.captain_update_roster_player(uuid,text,integer,integer,jsonb,text)'::regprocedure),
  'PUBLIC has no EXECUTE');
SELECT ok(has_function_privilege('authenticated', 'public.captain_update_roster_player(uuid,text,integer,integer,jsonb,text)', 'EXECUTE'),
  'signed-in users can execute (the function then checks assignment and role)');
SELECT ok((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.captain_update_roster_player(uuid,text,integer,integer,jsonb,text)'::regprocedure),
  'the RPC is SECURITY DEFINER');
SELECT is(
  (SELECT c FROM pg_proc p, unnest(p.proconfig) c
   WHERE p.oid = 'public.captain_update_roster_player(uuid,text,integer,integer,jsonb,text)'::regprocedure AND c LIKE 'search_path=%'),
  'search_path=""',
  'the RPC pins an empty search_path (every object is schema-qualified)');
SELECT is(
  (SELECT array_agg(p.parameter_name::text ORDER BY p.ordinal_position) FROM information_schema.parameters p
   JOIN information_schema.routines r ON r.specific_name = p.specific_name
   WHERE r.routine_schema = 'public' AND r.routine_name = 'captain_update_roster_player'),
  ARRAY['p_membership_id','p_position','p_jersey_number','p_overall_rating','p_attributes','p_image_url'],
  'the RPC takes only allow-listed fields: no name, email, account link or roster parameter');

-- Anonymous callers ----------------------------------------------------------------------------------------
SELECT throws_ok($$SELECT pg_temp.call_as('anon', NULL, 'a1000000-0000-4000-8000-000000000001', 'ST', 9, 80, '{}'::jsonb, 'hacked')$$,
  '42501', NULL, 'an anonymous caller is refused');
SELECT is((SELECT image_url FROM public.players WHERE id = 'e0000000-0000-4000-8000-000000000001'), 'old-a',
  'the anonymous attempt changed nothing');

-- A captain: holding the team's registration for the season AND the captain role ---------------------------
SELECT lives_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
  'ST', 9, 80, '{"playStyle":"Power Shot"}'::jsonb, 'new-a')$$,
  'the captain can update an existing player of their own team');
SELECT results_eq(
  $$SELECT rm.position, rm.jersey_number, p.overall_rating, p.attributes->>'playStyle', p.image_url, p.first_name::text, p.last_name::text
    FROM public.roster_memberships rm JOIN public.players p ON p.id = rm.player_id WHERE rm.id = 'a1000000-0000-4000-8000-000000000001'$$,
  $$VALUES ('ST'::text, 9, 80, 'Power Shot'::text, 'new-a'::text, 'Player'::text, 'A'::text)$$,
  'position and jersey on the roster place, rating, play style and portrait on the card changed; the name did not');
SELECT is((SELECT email FROM public.player_private_details WHERE player_id = 'e0000000-0000-4000-8000-000000000001'), 'player.a@iiitkottayam.ac.in',
  'the private email is untouched');
SELECT lives_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
  NULL, NULL, 70, '{}'::jsonb, NULL)$$,
  'a missing position and jersey number are allowed (partial saving)');
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
  'ST', 10, 70, '{}'::jsonb, NULL)$$,
  'P0001', 'Jersey number 10 is already taken on this team', 'a jersey number already used on the team is refused clearly');
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000005',
  'CB', 5, 70, '{}'::jsonb, 'x')$$,
  'P0001', 'Player is not part of your assigned roster', 'the captain''s assignment does not reach the same team in another season');

-- A captain of the same team in an earlier, no longer current season cannot reach the player's shared card.
INSERT INTO public.team_registrations (id, captain_id, team_name, season_id, team_id) VALUES
  ('d0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000008', 'RPC Team A old', 'f9000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001');
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000005',
  'CB', 5, 70, '{}'::jsonb, 'stale')$$,
  'P0001', 'Only the current season''s roster can be edited by its captain', 'a captain edits only the current season''s roster');
SELECT isnt((SELECT image_url FROM public.players WHERE id = 'e0000000-0000-4000-8000-000000000002'), 'stale', 'the shared card is unchanged');

-- Other teams, other roles ---------------------------------------------------------------------------------
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001',
  'GK', 1, 99, '{}'::jsonb, 'stolen')$$,
  'P0001', 'Player is not part of your assigned roster', 'a captain cannot change another team''s player');
SELECT is((SELECT image_url FROM public.players WHERE id = 'e0000000-0000-4000-8000-000000000001'), NULL,
  'the player is unchanged by the other captain (the last legitimate save left the portrait empty)');
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001',
  'GK', 1, 99, '{}'::jsonb, 'x')$$,
  'P0001', 'Player is not part of your assigned roster', 'a normal user is refused');
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001',
  'GK', 1, 99, '{}'::jsonb, 'x')$$,
  'P0001', 'Player is not part of your assigned roster', 'an editor who is not assigned is refused (editor is newsletter-only)');
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001',
  'GK', 1, 99, '{}'::jsonb, 'x')$$,
  'P0001', 'Player is not part of your assigned roster', 'a former legacy admin, now an ordinary user, is not treated as a dictator or captain');
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ff',
  'ST', 9, 80, '{}'::jsonb, NULL)$$,
  'P0001', 'Player is not part of your assigned roster', 'an unknown player gives the same error (no information about which players exist)');
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000001',
  'GK', 1, 99, '{}'::jsonb, 'x')$$,
  'P0001', 'Player is not part of your assigned roster', 'the captain role without an assignment to this team is refused');

-- Assigned to the team but WITHOUT the captain role: refused, never silently allowed -------------------------
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000003',
  'ST', 9, 80, '{}'::jsonb, 'new-c')$$,
  'P0001', 'Captain access is required to update players', 'a user assigned to the team but holding only the default role is refused');
SELECT is((SELECT image_url FROM public.players WHERE id = 'e0000000-0000-4000-8000-000000000003'), 'old-c',
  'nothing changed for the assigned user without the captain role');
UPDATE public.user_roles SET role = 'editor' WHERE user_id = 'c0000000-0000-4000-8000-000000000007';
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000003',
  'ST', 9, 80, '{}'::jsonb, 'new-c')$$,
  'P0001', 'Captain access is required to update players', 'an assigned editor is refused: no role implies another');
UPDATE public.user_roles SET role = 'default' WHERE user_id = 'c0000000-0000-4000-8000-000000000007';
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000003',
  'ST', 9, 80, '{}'::jsonb, 'new-c')$$,
  'P0001', 'Captain access is required to update players', 'an assigned former legacy admin, now an ordinary user, is refused');
UPDATE public.user_roles SET role = 'captain' WHERE user_id = 'c0000000-0000-4000-8000-000000000007';
SELECT lives_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000003',
  'ST', 9, 80, '{}'::jsonb, 'new-c')$$,
  'once the captain role is assigned deliberately, the same user can update their team''s player');

-- Dictators -------------------------------------------------------------------------------------------------
SELECT lives_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002',
  'GK', 1, 90, '{}'::jsonb, 'dict-b')$$,
  'a dictator can update any team''s player');
SELECT lives_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000005',
  'GK', 1, 90, '{}'::jsonb, 'dict-b')$$,
  'a dictator can update a roster place in any season');
SELECT is((SELECT image_url FROM public.players WHERE id = 'e0000000-0000-4000-8000-000000000002'), 'dict-b',
  'the dictator''s change was applied to the player''s card');

-- Captains have no direct write path to players or rosters --------------------------------------------------
CREATE FUNCTION pg_temp.direct_as(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.players SET first_name = 'Renamed' WHERE id = 'e0000000-0000-4000-8000-000000000001';
  DELETE FROM public.roster_memberships WHERE id = 'a1000000-0000-4000-8000-000000000001';
  RESET ROLE;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RAISE;
END;
$$;
SELECT lives_ok($$SELECT pg_temp.direct_as('c0000000-0000-4000-8000-000000000001')$$,
  'a captain''s direct rename and roster delete run but are filtered by RLS');
SELECT is((SELECT first_name::text FROM public.players WHERE id = 'e0000000-0000-4000-8000-000000000001'), 'Player', 'the direct rename changed nothing');
SELECT is((SELECT count(*) FROM public.roster_memberships WHERE id = 'a1000000-0000-4000-8000-000000000001')::int, 1, 'the direct roster delete changed nothing');

-- Validation -------------------------------------------------------------------------------------------------
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
  'XX', 9, 80, '{}'::jsonb, NULL)$$, 'P0001', 'Choose a valid player position', 'an unknown position is rejected');
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
  'ST', 100, 80, '{}'::jsonb, NULL)$$, 'P0001', 'Jersey number must be between 0 and 99', 'a jersey number outside 0-99 is rejected');
SELECT lives_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
  'ST', 0, 80, '{}'::jsonb, NULL)$$, 'jersey number 0 is allowed, as the roster table allows it');
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
  'ST', 9, 100, '{}'::jsonb, NULL)$$, 'P0001', 'Overall rating must be between 1 and 99', 'a rating outside 1-99 is rejected');
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
  'ST', 9, 80, '[]'::jsonb, NULL)$$, 'P0001', 'Player attributes must be an object', 'attributes that are not an object are rejected');
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', NULL, 'a1000000-0000-4000-8000-000000000001',
  'ST', 9, 80, '{}'::jsonb, NULL)$$, 'P0001', 'You must be signed in', 'a signed-in user is required even if the role is authenticated');

SELECT * FROM finish();
ROLLBACK;

-- Group: database. The 7-argument captain_update_team_member RPC may be used only by
--   * a captain: assigned to the team entry that owns the player AND holding the captain role, or
--   * a dictator (any team).
-- Captains may change only the approved presentation fields (never the email); the function pins its
-- search_path; anonymous callers and PUBLIC cannot execute it. Roles follow
-- docs/decisions/SL-003-role-capability-matrix.md. Scorer is not a stored role yet, so it cannot be tested
-- here; editor, normal user and legacy admin are.
BEGIN;
SELECT plan(37);

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
UPDATE public.user_roles SET role = 'admin'    WHERE user_id = 'c0000000-0000-4000-8000-000000000006';
-- user 4 (normal) and user 7 (assigned.norole) keep the default role

INSERT INTO public.team_registrations (id, captain_id, team_name, division) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'RPC Team A', 'freshers'),
  ('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'RPC Team B', 'freshers'),
  ('d0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000007', 'RPC Team C', 'freshers');

INSERT INTO public.team_members (id, registration_id, name, email, position, jersey_number, overall_rating, attributes, image_url) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'Player A', 'player.a@iiitkottayam.ac.in', 'CM', 7, 60, '{}', 'old-a'),
  ('e0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'Player B', 'player.b@iiitkottayam.ac.in', 'CB', 4, 55, '{}', 'old-b'),
  ('e0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003', 'Player C', 'player.c@iiitkottayam.ac.in', 'GK', 1, 50, '{}', 'old-c');

-- Calls the RPC the way the API does: switch to an API role and set the JWT claims, then switch back.
CREATE FUNCTION pg_temp.call_as(p_role text, p_uid uuid, p_member uuid, p_position text, p_jersey integer,
                                p_rating integer, p_attrs jsonb, p_email text, p_image text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN '{}' ELSE json_build_object('sub', p_uid, 'role', p_role)::text END, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  PERFORM public.captain_update_team_member(p_member, p_position, p_jersey, p_rating, p_attrs, p_email, p_image);
  RESET ROLE;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RAISE;
END;
$$;

-- Privileges and settings ----------------------------------------------------------------------------------
SELECT ok(NOT has_function_privilege('anon', 'public.captain_update_team_member(uuid,text,integer,integer,jsonb,text,text)', 'EXECUTE'),
  '7-argument RPC: anon cannot execute');
SELECT ok(NOT has_function_privilege('anon', 'public.captain_update_team_member(uuid,text,integer,integer,jsonb)', 'EXECUTE'),
  '5-argument RPC: anon cannot execute');
SELECT ok(
  (SELECT p.proacl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
   FROM pg_proc p WHERE p.oid = 'public.captain_update_team_member(uuid,text,integer,integer,jsonb,text,text)'::regprocedure),
  '7-argument RPC: PUBLIC has no EXECUTE');
SELECT ok(
  (SELECT p.proacl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
   FROM pg_proc p WHERE p.oid = 'public.captain_update_team_member(uuid,text,integer,integer,jsonb)'::regprocedure),
  '5-argument RPC: PUBLIC has no EXECUTE');
SELECT ok(has_function_privilege('authenticated', 'public.captain_update_team_member(uuid,text,integer,integer,jsonb,text,text)', 'EXECUTE'),
  '7-argument RPC: signed-in users can execute (the function then checks assignment and role)');
SELECT ok(has_function_privilege('service_role', 'public.captain_update_team_member(uuid,text,integer,integer,jsonb,text,text)', 'EXECUTE'),
  '7-argument RPC: service_role can execute');
SELECT ok((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.captain_update_team_member(uuid,text,integer,integer,jsonb,text,text)'::regprocedure),
  '7-argument RPC is SECURITY DEFINER');
SELECT is(
  (SELECT c FROM pg_proc p, unnest(p.proconfig) c
   WHERE p.oid = 'public.captain_update_team_member(uuid,text,integer,integer,jsonb,text,text)'::regprocedure AND c LIKE 'search_path=%'),
  'search_path=""',
  '7-argument RPC pins an empty search_path (every object is schema-qualified)');

-- Anonymous callers ----------------------------------------------------------------------------------------
SELECT throws_ok($$SELECT pg_temp.call_as('anon', NULL, 'e0000000-0000-4000-8000-000000000001', 'ST', 9, 80, '{}'::jsonb, NULL, 'hacked')$$,
  '42501', NULL, 'an anonymous caller is refused');
SELECT is((SELECT image_url FROM public.team_members WHERE id = 'e0000000-0000-4000-8000-000000000001'), 'old-a',
  'the anonymous attempt changed nothing');

-- A captain: assigned to the team AND holding the captain role ---------------------------------------------
SELECT lives_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
  'ST', 9, 80, '{"playStyles":[{"name":"Finisher"}]}'::jsonb, NULL, 'new-a')$$,
  'the captain can update an existing player of their own team');
SELECT results_eq(
  $$SELECT position, jersey_number, overall_rating, attributes->'playStyles'->0->>'name', image_url, email
    FROM public.team_members WHERE id = 'e0000000-0000-4000-8000-000000000001'$$,
  $$VALUES ('ST'::text, 9, 80, 'Finisher'::text, 'new-a'::text, 'player.a@iiitkottayam.ac.in'::text)$$,
  'position, jersey, rating, play style and portrait changed; the email is untouched');
SELECT lives_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
  'ST', 9, 80, '{}'::jsonb, 'player.a@iiitkottayam.ac.in', 'new-a')$$,
  'sending the email that is already stored is accepted (no change)');
SELECT lives_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
  NULL, NULL, 70, '{}'::jsonb, NULL, NULL)$$,
  'a missing position and jersey number are allowed (partial saving)');

-- Captains cannot change the email -------------------------------------------------------------------------
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
  'ST', 9, 80, '{}'::jsonb, 'changed@iiitkottayam.ac.in', 'new-a')$$,
  'P0001', 'Only a dictator can change a player''s email', 'a captain cannot change a player''s email');
SELECT is((SELECT email FROM public.team_members WHERE id = 'e0000000-0000-4000-8000-000000000001'), 'player.a@iiitkottayam.ac.in',
  'the email is unchanged after the attempt');

-- Other teams, other roles ---------------------------------------------------------------------------------
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001',
  'GK', 1, 99, '{}'::jsonb, NULL, 'stolen')$$,
  'P0001', 'Player is not part of your assigned roster', 'a captain cannot change another team''s player');
SELECT is((SELECT image_url FROM public.team_members WHERE id = 'e0000000-0000-4000-8000-000000000001'), NULL,
  'the player is unchanged by the other captain (the last legitimate save left the portrait empty)');
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001',
  'GK', 1, 99, '{}'::jsonb, NULL, 'x')$$,
  'P0001', 'Player is not part of your assigned roster', 'a normal user is refused');
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000001',
  'GK', 1, 99, '{}'::jsonb, NULL, 'x')$$,
  'P0001', 'Player is not part of your assigned roster', 'an editor who is not assigned is refused (editor is newsletter-only)');
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000001',
  'GK', 1, 99, '{}'::jsonb, NULL, 'x')$$,
  'P0001', 'Player is not part of your assigned roster', 'a legacy admin is not treated as a dictator or captain');
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-0000000000ff',
  'ST', 9, 80, '{}'::jsonb, NULL, NULL)$$,
  'P0001', 'Player is not part of your assigned roster', 'an unknown player gives the same error (no information about which players exist)');
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000008', 'e0000000-0000-4000-8000-000000000001',
  'GK', 1, 99, '{}'::jsonb, NULL, 'x')$$,
  'P0001', 'Player is not part of your assigned roster', 'the captain role without an assignment to this team is refused');

-- Assigned to the team but WITHOUT the captain role: refused, never silently allowed -------------------------
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000003',
  'ST', 9, 80, '{}'::jsonb, NULL, 'new-c')$$,
  'P0001', 'Captain access is required to update players', 'a user assigned to the team but holding only the default role is refused');
SELECT is((SELECT image_url FROM public.team_members WHERE id = 'e0000000-0000-4000-8000-000000000003'), 'old-c',
  'nothing changed for the assigned user without the captain role');
UPDATE public.user_roles SET role = 'editor' WHERE user_id = 'c0000000-0000-4000-8000-000000000007';
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000003',
  'ST', 9, 80, '{}'::jsonb, NULL, 'new-c')$$,
  'P0001', 'Captain access is required to update players', 'an assigned editor is refused: no role implies another');
UPDATE public.user_roles SET role = 'admin' WHERE user_id = 'c0000000-0000-4000-8000-000000000007';
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000003',
  'ST', 9, 80, '{}'::jsonb, NULL, 'new-c')$$,
  'P0001', 'Captain access is required to update players', 'an assigned legacy admin is refused');
UPDATE public.user_roles SET role = 'captain' WHERE user_id = 'c0000000-0000-4000-8000-000000000007';
SELECT lives_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000003',
  'ST', 9, 80, '{}'::jsonb, NULL, 'new-c')$$,
  'once the captain role is assigned deliberately, the same user can update their team''s player');

-- Dictators -------------------------------------------------------------------------------------------------
SELECT lives_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000002',
  'GK', 1, 90, '{}'::jsonb, 'player.b2@iiitkottayam.ac.in', 'dict-b')$$,
  'a dictator can update any team''s player, including the email');
SELECT is((SELECT email FROM public.team_members WHERE id = 'e0000000-0000-4000-8000-000000000002'), 'player.b2@iiitkottayam.ac.in',
  'the dictator''s email change was applied');
SELECT lives_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000002',
  'GK', 1, 90, '{}'::jsonb, NULL, 'dict-b')$$,
  'a NULL email means no change, even for a dictator');
SELECT is((SELECT email FROM public.team_members WHERE id = 'e0000000-0000-4000-8000-000000000002'), 'player.b2@iiitkottayam.ac.in',
  'the email was not cleared');

-- Validation (same rules as the 5-argument overload) --------------------------------------------------------
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
  'XX', 9, 80, '{}'::jsonb, NULL, NULL)$$, 'P0001', 'Choose a valid player position', 'an unknown position is rejected');
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
  'ST', 0, 80, '{}'::jsonb, NULL, NULL)$$, 'P0001', 'Jersey number must be between 1 and 99', 'a jersey number outside 1-99 is rejected');
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
  'ST', 9, 100, '{}'::jsonb, NULL, NULL)$$, 'P0001', 'Overall rating must be between 1 and 99', 'a rating outside 1-99 is rejected');
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
  'ST', 9, 80, '[]'::jsonb, NULL, NULL)$$, 'P0001', 'Player attributes must be an object', 'attributes that are not an object are rejected');
SELECT throws_ok($$SELECT pg_temp.call_as('authenticated', NULL, 'e0000000-0000-4000-8000-000000000001',
  'ST', 9, 80, '{}'::jsonb, NULL, NULL)$$, 'P0001', 'You must be signed in', 'a signed-in user is required even if the role is authenticated');

SELECT * FROM finish();
ROLLBACK;

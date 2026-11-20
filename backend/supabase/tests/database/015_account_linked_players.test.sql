-- Group: database. Account-linked players: one player per account and one account per player, links only to verified
-- accounts and only by a dictator on every path (direct writes, roster and self-service functions, the server key),
-- the link unreadable to anyone else, unlinking keeps everything but the link, an account deletion keeps the player,
-- a linked player edits only their own portrait and preferred foot, the account-link import never writes on a problem
-- row, and the audit history records it all without emails. Rolled back.
BEGIN;
SELECT plan(29);

-- Accounts: 1 dictator, 2 captain, 3 verified fan, 4 another verified fan, 5 unverified, 6 verified (to delete).
INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
SELECT ('d1000000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated',
       (ARRAY['al.boss','al.captain','al.fan','al.other','al.unverified','al.gone'])[n] || '@iiitkottayam.ac.in', '',
       CASE WHEN n = 5 THEN NULL ELSE now() END, now(), now()
FROM generate_series(1, 6) AS n;
INSERT INTO public.user_roles (user_id, role) SELECT id, 'dictator' FROM auth.users WHERE id = 'd1000000-0000-4000-8000-000000000001' ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role) SELECT id, 'captain' FROM auth.users WHERE id = 'd1000000-0000-4000-8000-000000000002' ON CONFLICT DO NOTHING;
INSERT INTO public.players (id, first_name, last_name, overall_rating, attributes) VALUES
  ('d1900000-0000-4000-8000-000000000001', 'Linked', 'Lane', 70, '{"stats": {"Pace": {"total": 80}}, "playStyle": "Power Shot", "keep": 1}'),
  ('d1900000-0000-4000-8000-000000000002', 'Second', 'Player', 60, '{}'),
  ('d1900000-0000-4000-8000-000000000003', 'Gone', 'Account', 61, '{}'),
  ('d1900000-0000-4000-8000-000000000004', 'Fourth', 'Player', 62, '{}');

CREATE FUNCTION pg_temp.as_user(p_n integer, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ('d1000000-0000-4000-8000-00000000000' || p_n)::uuid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  EXECUTE p_sql INTO v;
  RESET ROLE;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RAISE;
END;
$$;
CREATE FUNCTION pg_temp.as_server(p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role": "service_role"}', true);
  SET LOCAL ROLE service_role;
  EXECUTE p_sql INTO v;
  RESET ROLE;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RAISE;
END;
$$;
CREATE FUNCTION pg_temp.link_of(p uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT user_id FROM public.players WHERE id = p $$;

-- C1: the link column ---------------------------------------------------------------------------------------------
SELECT has_column('public', 'players', 'user_id', 'players have an account link');
SELECT col_is_null('public', 'players', 'user_id', 'the link is optional');
SELECT ok(NOT has_column_privilege('anon', 'public.players', 'user_id', 'SELECT')
          AND NOT has_column_privilege('authenticated', 'public.players', 'user_id', 'SELECT'), 'nobody but the server can read the link');
SELECT ok(has_column_privilege('anon', 'public.players', 'first_name', 'SELECT'), 'public pages still read the card');

-- C2: linking -----------------------------------------------------------------------------------------------------
SELECT lives_ok($$SELECT pg_temp.as_user(1, $q$SELECT public.link_player_account('d1900000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000003')::text$q$)$$,
  'a dictator links a verified account');
SELECT is(pg_temp.link_of('d1900000-0000-4000-8000-000000000001'), 'd1000000-0000-4000-8000-000000000003'::uuid, 'the link is stored');
SELECT throws_ok($$SELECT pg_temp.as_user(1, $q$SELECT public.link_player_account('d1900000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000005')::text$q$)$$,
  '23514', NULL, 'an unverified account is refused');
SELECT throws_ok($$SELECT pg_temp.as_user(1, $q$SELECT public.link_player_account('d1900000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000003')::text$q$)$$,
  '23505', NULL, 'a second player for the same account is refused');
SELECT throws_ok($$SELECT pg_temp.as_user(1, $q$SELECT public.link_player_account('d1900000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000004')::text$q$)$$,
  '23505', NULL, 'a second account for an already linked player is refused');

-- C3: nobody else, on any path --------------------------------------------------------------------------------------
SELECT throws_ok($$SELECT pg_temp.as_user(2, $q$SELECT public.link_player_account('d1900000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000002')::text$q$)$$,
  '42501', NULL, 'a captain cannot link');
SELECT throws_ok($$SELECT pg_temp.as_user(3, $q$SELECT public.unlink_player_account('d1900000-0000-4000-8000-000000000001')::text$q$)$$,
  '42501', NULL, 'a player cannot unlink themself');
SELECT throws_ok($$SELECT pg_temp.as_user(4, $q$WITH u AS (UPDATE public.players SET user_id = 'd1000000-0000-4000-8000-000000000004' WHERE id = 'd1900000-0000-4000-8000-000000000002' RETURNING 1) SELECT count(*)::text FROM u$q$)$$,
  '42501', NULL, 'a user cannot claim a player by writing the link directly');
SELECT throws_ok($$SELECT pg_temp.as_server($q$WITH u AS (UPDATE public.players SET user_id = 'd1000000-0000-4000-8000-000000000004' WHERE id = 'd1900000-0000-4000-8000-000000000002' RETURNING 1) SELECT count(*)::text FROM u$q$)$$,
  '42501', NULL, 'the server key cannot link either');
SELECT throws_ok($$SELECT pg_temp.as_server($q$INSERT INTO public.players (first_name, last_name, user_id) VALUES ('Sneaky', 'Insert', 'd1000000-0000-4000-8000-000000000004') RETURNING id::text$q$)$$,
  '42501', NULL, 'nor create a linked player');
SELECT is(pg_temp.link_of('d1900000-0000-4000-8000-000000000002'), NULL::uuid, 'and nothing was linked');

-- C5: self-service ----------------------------------------------------------------------------------------------------
SELECT is(pg_temp.as_user(3, $q$SELECT (public.my_player() ->> 'first_name')$q$), 'Linked', 'a linked player reads their own card');
SELECT is(pg_temp.as_user(3, $q$SELECT (public.my_player() ->> 'email')$q$), 'al.fan@iiitkottayam.ac.in', 'and their own Auth email');
SELECT lives_ok($$SELECT pg_temp.as_user(3, $q$SELECT public.update_my_player('https://media.example/players/d1900000-0000-4000-8000-000000000001.png', 'Left')::text$q$)$$,
  'a linked player sets their own portrait and preferred foot');
SELECT results_eq($$SELECT image_url, attributes FROM public.players WHERE id = 'd1900000-0000-4000-8000-000000000001'$$,
  $$VALUES ('https://media.example/players/d1900000-0000-4000-8000-000000000001.png'::text,
            '{"stats": {"Pace": {"total": 80}}, "playStyle": "Power Shot", "keep": 1, "bio": {"preferredFoot": "Left"}}'::jsonb)$$,
  'only the portrait and foot changed; rating, stats, play style and other values are untouched');
SELECT is((SELECT overall_rating FROM public.players WHERE id = 'd1900000-0000-4000-8000-000000000001'), 70, 'the rating is unchanged');
SELECT throws_ok($$SELECT pg_temp.as_user(3, $q$SELECT public.update_my_player('https://media.example/players/d1900000-0000-4000-8000-000000000002.png', 'Left')::text$q$)$$,
  '22023', NULL, 'another player''s portrait is refused');
SELECT throws_ok($$SELECT pg_temp.as_user(4, $q$SELECT public.update_my_player(NULL, 'Right')::text$q$)$$,
  '42501', NULL, 'a user without a linked player is refused');

-- C6: audit -------------------------------------------------------------------------------------------------------------
SELECT ok(EXISTS (SELECT 1 FROM public.audit_log WHERE table_name = 'players' AND record_id = 'd1900000-0000-4000-8000-000000000001'
                    AND actor_id = 'd1000000-0000-4000-8000-000000000001' AND changes ? 'user_id'), 'the link is in the audit history with the dictator as actor');
SELECT ok(EXISTS (SELECT 1 FROM public.audit_log WHERE table_name = 'players' AND record_id = 'd1900000-0000-4000-8000-000000000001'
                    AND actor_id = 'd1000000-0000-4000-8000-000000000003' AND changes ? 'image_url'), 'the self-edit is in the audit history with the player as actor');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE table_name = 'players' AND changes::text ILIKE '%@iiitkottayam%'), 0, 'no email appears in the players history');

-- C7: the CSV import is replaced by verified-email matching (017) ---------------------------------------------------
SELECT ok(to_regprocedure('public.preview_player_account_links(jsonb)') IS NULL AND to_regprocedure('public.apply_player_account_links(jsonb)') IS NULL
          AND to_regprocedure('public.player_link_candidates(text)') IS NULL, 'the CSV import and the name-or-email account search are gone');

-- C4 and the account-deletion path ----------------------------------------------------------------------------------
SELECT lives_ok($$SELECT pg_temp.as_user(1, $q$SELECT public.unlink_player_account('d1900000-0000-4000-8000-000000000001')::text$q$)$$, 'a dictator unlinks');
SELECT results_eq($$SELECT user_id, first_name::text, image_url FROM public.players p
                    WHERE id = 'd1900000-0000-4000-8000-000000000001'$$,
  $$VALUES (NULL::uuid, 'Linked'::text, 'https://media.example/players/d1900000-0000-4000-8000-000000000001.png'::text)$$,
  'unlinking clears only the link');
UPDATE public.players SET user_id = 'd1000000-0000-4000-8000-000000000006' WHERE id = 'd1900000-0000-4000-8000-000000000003'; -- as the owner (seed path)
DELETE FROM auth.users WHERE id = 'd1000000-0000-4000-8000-000000000006';
SELECT results_eq($$SELECT user_id, first_name::text FROM public.players WHERE id = 'd1900000-0000-4000-8000-000000000003'$$,
  $$VALUES (NULL::uuid, 'Gone'::text)$$, 'deleting an account keeps its player and clears the link');

SELECT * FROM finish();
ROLLBACK;

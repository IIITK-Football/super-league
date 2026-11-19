-- Group: database. Verified-email matching, automatic linking and account-first players (20261130000006/7):
-- Auth is the only email source (no contact-email table; the migration evidence holds no address), match keys are
-- private, a new player needs a verified account and a new roster place a linked player on every API path (the server
-- key included), the preview reports each case and apply links only still-ready pairs, an account is linked
-- automatically when its email becomes verified (exactly one matching unlinked player, never otherwise, never blocking
-- the confirmation), a linked player is never moved to another account in one step, and the audit history records
-- it all without an address. Rolled back.
BEGIN;
SELECT plan(35);

-- Accounts: 1 dictator, 2 captain, 3 verified (ready), 4 verified (duplicate key), 5 unverified (waiting),
-- 6 verified (new player), 7 unverified (auto-link on confirmation), 8 verified (already linked: conflict).
INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
SELECT ('d2000000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated',
       (ARRAY['em.boss','em.captain','em.ready','em.dup','em.waiting','em.new','em.later','em.linked'])[n] || '@iiitkottayam.ac.in', '',
       CASE WHEN n IN (5, 7) THEN NULL ELSE now() END, now(), now()
FROM generate_series(1, 8) AS n;
UPDATE public.user_roles SET role = 'dictator' WHERE user_id = 'd2000000-0000-4000-8000-000000000001';
UPDATE public.user_roles SET role = 'captain' WHERE user_id = 'd2000000-0000-4000-8000-000000000002';
-- Legacy (unlinked) players and their keys, as the migration leaves them (this session has no request JWT).
INSERT INTO public.players (id, first_name, last_name) VALUES
  ('d2900000-0000-4000-8000-000000000001', 'Ready', 'Match'),
  ('d2900000-0000-4000-8000-000000000002', 'Dup', 'One'),
  ('d2900000-0000-4000-8000-000000000003', 'Dup', 'Two'),
  ('d2900000-0000-4000-8000-000000000004', 'Waiting', 'Verify'),
  ('d2900000-0000-4000-8000-000000000005', 'Later', 'Confirm'),
  ('d2900000-0000-4000-8000-000000000006', 'Already', 'Linked'),
  ('d2900000-0000-4000-8000-000000000007', 'Conflict', 'Key'),
  ('d2900000-0000-4000-8000-000000000008', 'No', 'Account');
UPDATE public.players SET user_id = 'd2000000-0000-4000-8000-000000000008' WHERE id = 'd2900000-0000-4000-8000-000000000006';
INSERT INTO public.player_link_keys (player_id, email) VALUES
  ('d2900000-0000-4000-8000-000000000001', 'em.ready@iiitkottayam.ac.in'),
  ('d2900000-0000-4000-8000-000000000002', 'em.dup@iiitkottayam.ac.in'),
  ('d2900000-0000-4000-8000-000000000003', 'em.dup@iiitkottayam.ac.in'),
  ('d2900000-0000-4000-8000-000000000004', 'em.waiting@iiitkottayam.ac.in'),
  ('d2900000-0000-4000-8000-000000000005', 'em.later@iiitkottayam.ac.in'),
  ('d2900000-0000-4000-8000-000000000007', 'em.linked@iiitkottayam.ac.in'),
  ('d2900000-0000-4000-8000-000000000008', 'em.nobody@iiitkottayam.ac.in');
INSERT INTO public.divisions (id, slug, name) VALUES ('d2a00000-0000-4000-8000-000000000001', 'em-div', 'EM Division');
INSERT INTO public.seasons (id, division_id, slug, name, is_current) VALUES ('d2b00000-0000-4000-8000-000000000001', 'd2a00000-0000-4000-8000-000000000001', 'em-1', 'EM 1', true);
INSERT INTO public.teams (id, name) VALUES ('d2c00000-0000-4000-8000-000000000001', 'EM Team');
INSERT INTO public.team_entries (id, team_id, season_id) VALUES ('d2d00000-0000-4000-8000-000000000001', 'd2c00000-0000-4000-8000-000000000001', 'd2b00000-0000-4000-8000-000000000001');

CREATE FUNCTION pg_temp.as_role(p_role text, p_n integer, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN p_role = 'service_role' THEN '{"role": "service_role"}'
    ELSE json_build_object('sub', ('d2000000-0000-4000-8000-00000000000' || p_n)::uuid, 'role', p_role)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  EXECUTE p_sql INTO v;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END;
$$;
CREATE FUNCTION pg_temp.as_user(p_n integer, p_sql text) RETURNS text LANGUAGE sql AS $$ SELECT pg_temp.as_role('authenticated', p_n, p_sql) $$;
CREATE FUNCTION pg_temp.link_of(p uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT user_id FROM public.players WHERE id = p $$;

-- C1: Auth is the only email source; evidence without addresses; private keys -------------------------------------
SELECT hasnt_table('public', 'player_private_details', 'the contact-email table is gone');
SELECT columns_are('public', 'player_email_migration_outcomes', ARRAY['player_id', 'outcome', 'recorded_at'], 'the migration evidence holds no email address');
SELECT ok(NOT has_table_privilege('authenticated', 'public.player_link_keys', 'SELECT') AND NOT has_table_privilege('anon', 'public.player_link_keys', 'SELECT'),
  'match keys are not readable through the Data API');
SELECT throws_ok($$INSERT INTO public.player_link_keys (player_id, email) VALUES ('d2900000-0000-4000-8000-000000000008', ' Mixed@Case.in')$$,
  '23514', NULL, 'a key is stored normalized only');

-- C7: the preview ---------------------------------------------------------------------------------------------------
SELECT is(pg_temp.as_user(1, $q$SELECT string_agg(status, ',' ORDER BY player_id) FROM public.account_link_matches() WHERE player_id::text LIKE 'd29%'$q$),
  'ready,duplicate,duplicate,waiting_verification,waiting_verification,conflict,no_account',
  'each key is ready, duplicate, waiting for verification, a conflict or without an account');
SELECT throws_ok($$SELECT pg_temp.as_user(2, 'SELECT count(*)::text FROM public.account_link_matches()')$$, '42501', NULL, 'only a dictator reviews matches');

-- Apply: only previewed pairs that are still ready ----------------------------------------------------------------------
CREATE TEMP TABLE applied AS SELECT pg_temp.as_user(1, $q$SELECT public.apply_account_link_matches('[
  {"player_id": "d2900000-0000-4000-8000-000000000001", "user_id": "d2000000-0000-4000-8000-000000000003"},
  {"player_id": "d2900000-0000-4000-8000-000000000002", "user_id": "d2000000-0000-4000-8000-000000000004"},
  {"player_id": "d2900000-0000-4000-8000-000000000001", "user_id": "d2000000-0000-4000-8000-000000000004"}]'::jsonb)::text$q$)::jsonb AS r;
SELECT is((SELECT (r ->> 'linked')::int || ' ' || (SELECT string_agg(s ->> 'status', ',' ORDER BY s ->> 'status') FROM jsonb_array_elements(r -> 'skipped') s) FROM applied),
  '1 changed,duplicate', 'apply links the ready pair and skips a duplicate and a pair that is not a match');
SELECT is(pg_temp.link_of('d2900000-0000-4000-8000-000000000001'), 'd2000000-0000-4000-8000-000000000003'::uuid, 'the ready match is linked');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.player_link_keys WHERE player_id = 'd2900000-0000-4000-8000-000000000001'), 'and its key is removed');
SELECT is((pg_temp.as_user(1, $q$SELECT public.apply_account_link_matches('[{"player_id": "d2900000-0000-4000-8000-000000000001", "user_id": "d2000000-0000-4000-8000-000000000003"}]'::jsonb)::text$q$)::jsonb ->> 'linked')::int,
  0, 'applying again links nothing');
SELECT is(pg_temp.link_of('d2900000-0000-4000-8000-000000000002'), NULL::uuid, 'duplicates stay unlinked');

-- C8: automatic link when an email becomes verified ---------------------------------------------------------------
SELECT is(pg_temp.link_of('d2900000-0000-4000-8000-000000000005'), NULL::uuid, 'nothing is linked before verification');
UPDATE auth.users SET email_confirmed_at = now() WHERE id = 'd2000000-0000-4000-8000-000000000007';
SELECT is(pg_temp.link_of('d2900000-0000-4000-8000-000000000005'), 'd2000000-0000-4000-8000-000000000007'::uuid, 'confirming the email links the one matching player');
SELECT ok(EXISTS (SELECT 1 FROM public.audit_log WHERE table_name = 'players' AND record_id = 'd2900000-0000-4000-8000-000000000005'
                    AND actor_role = 'auto-link' AND actor_id IS NULL AND changes ? 'user_id'), 'the automatic link is audited as auto-link');
UPDATE auth.users SET email_confirmed_at = now() WHERE id = 'd2000000-0000-4000-8000-000000000007';
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE table_name = 'players' AND record_id = 'd2900000-0000-4000-8000-000000000005' AND actor_role = 'auto-link'),
  1, 'a later confirmation update does nothing more');
UPDATE auth.users SET email_confirmed_at = NULL WHERE id = 'd2000000-0000-4000-8000-000000000004';
UPDATE auth.users SET email_confirmed_at = now() WHERE id = 'd2000000-0000-4000-8000-000000000004';
SELECT ok(pg_temp.link_of('d2900000-0000-4000-8000-000000000002') IS NULL AND pg_temp.link_of('d2900000-0000-4000-8000-000000000003') IS NULL,
  'a verification matching two players links neither');
INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES ('d2000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'em.nomatch@iiitkottayam.ac.in', '', now(), now(), now());
SELECT ok(NOT EXISTS (SELECT 1 FROM public.players WHERE user_id = 'd2000000-0000-4000-8000-00000000000a'), 'a verified sign-up with no match stays unlinked and creates no player');
-- A broken link never blocks the confirmation: make the link impossible and confirm anyway.
ALTER TABLE public.players DISABLE TRIGGER players_drop_link_key;
CREATE FUNCTION pg_temp.boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$;
CREATE TRIGGER zz_boom BEFORE UPDATE OF user_id ON public.players FOR EACH ROW EXECUTE FUNCTION pg_temp.boom();
SELECT lives_ok($$UPDATE auth.users SET email_confirmed_at = now() WHERE id = 'd2000000-0000-4000-8000-000000000005'$$, 'the confirmation succeeds even when linking fails');
SELECT is(pg_temp.link_of('d2900000-0000-4000-8000-000000000004'), NULL::uuid, 'and that player stays unlinked');
DROP TRIGGER zz_boom ON public.players;
ALTER TABLE public.players ENABLE TRIGGER players_drop_link_key;

-- C2/C3: manual links, one-to-one, no other path -------------------------------------------------------------------
SELECT throws_ok($$SELECT pg_temp.as_user(1, $q$SELECT public.link_player_account('d2900000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000006')::text$q$)$$,
  '23505', NULL, 'a linked player is not moved to another account in one step');
SELECT throws_ok($$UPDATE public.players SET user_id = 'd2000000-0000-4000-8000-000000000006' WHERE id = 'd2900000-0000-4000-8000-000000000001'$$,
  '23505', NULL, 'not even by a direct write');
SELECT throws_ok($$SELECT pg_temp.as_user(2, $q$SELECT public.link_player_account('d2900000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000004')::text$q$)$$,
  '42501', NULL, 'a captain cannot link');
SELECT lives_ok($$SELECT pg_temp.as_user(1, $q$SELECT public.link_player_account('d2900000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000004')::text$q$)$$,
  'a dictator resolves a duplicate by hand');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.player_link_keys WHERE player_id = 'd2900000-0000-4000-8000-000000000002'), 'the linked player''s key is removed');

INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES ('d2000000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'em.unverified@iiitkottayam.ac.in', '', NULL, now(), now());
-- C9: account-first players ------------------------------------------------------------------------------------------
SELECT throws_ok($$SELECT pg_temp.as_role('service_role', 0, $q$INSERT INTO public.players (first_name, last_name) VALUES ('Sneaky', 'Server') RETURNING id::text$q$)$$,
  '42501', NULL, 'the server key cannot create a player without an account');
SELECT throws_ok($$SELECT pg_temp.as_user(1, $q$INSERT INTO public.players (first_name, last_name) VALUES ('Direct', 'Insert') RETURNING id::text$q$)$$,
  '42501', NULL, 'nor can a dictator through a direct write');
SELECT ok(to_regprocedure('public.create_rostered_player(uuid,text,text,integer,text,integer,jsonb,text,text)') IS NULL, 'the account-less creator is gone');
SELECT throws_ok($$SELECT pg_temp.as_user(1, $q$SELECT public.create_player_for_account('d2000000-0000-4000-8000-00000000000b', 'd2d00000-0000-4000-8000-000000000001', 'No', 'Verify')::text$q$)$$,
  '23514', NULL, 'an unverified account cannot get a new player');
SELECT throws_ok($$SELECT pg_temp.as_user(1, $q$SELECT public.create_player_for_account('d2000000-0000-4000-8000-000000000003', 'd2d00000-0000-4000-8000-000000000001', 'Dupe', 'Identity')::text$q$)$$,
  '23505', NULL, 'an account that already has a player gets no second one');
SELECT ok(pg_temp.as_user(1, $q$SELECT public.create_player_for_account('d2000000-0000-4000-8000-000000000006', 'd2d00000-0000-4000-8000-000000000001', 'Fresh', 'Player', 7, 'ST', 70)::text$q$) IS NOT NULL,
  'a dictator creates a player for a verified account');
SELECT results_eq($$SELECT p.first_name::text, m.jersey_number FROM public.players p JOIN public.roster_memberships m ON m.player_id = p.id
                    WHERE p.user_id = 'd2000000-0000-4000-8000-000000000006'$$,
  $$VALUES ('Fresh'::text, 7)$$, 'linked and on the roster in one step');

-- C10: roster places need a linked player ---------------------------------------------------------------------------
SELECT throws_ok($$SELECT pg_temp.as_user(1, $q$SELECT public.add_player_to_roster('d2900000-0000-4000-8000-000000000008', 'd2d00000-0000-4000-8000-000000000001')::text$q$)$$,
  '23514', NULL, 'an unlinked player cannot join a roster');
SELECT throws_ok($$SELECT pg_temp.as_role('service_role', 0, $q$INSERT INTO public.roster_memberships (player_id, team_entry_id, season_id) VALUES ('d2900000-0000-4000-8000-000000000008', 'd2d00000-0000-4000-8000-000000000001', 'd2b00000-0000-4000-8000-000000000001') RETURNING id::text$q$)$$,
  '23514', NULL, 'not even with the server key');
SELECT ok(pg_temp.as_user(1, $q$SELECT public.add_player_to_roster('d2900000-0000-4000-8000-000000000001', 'd2d00000-0000-4000-8000-000000000001', 4)::text$q$) IS NOT NULL,
  'a linked player joins the roster');

-- C6: no address in the audit history ---------------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE table_name IN ('players', 'player_link_keys', 'roster_memberships')
           AND changes::text ILIKE '%@iiitkottayam%'), 0, 'no email address appears in the audit history');

SELECT * FROM finish();
ROLLBACK;

-- Group: database. College-domain rule and new-user triggers on auth.users.
BEGIN;
SELECT plan(14);

SELECT lives_ok(
  $$INSERT INTO auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES ('90000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'student@iiitkottayam.ac.in', '',
            '{"provider":"google","providers":["google"]}', '{"full_name":"Test Student"}', now(), now())$$,
  'a college email can be created');

SELECT is((SELECT real_name FROM public.user_profiles WHERE id = '90000000-0000-4000-8000-000000000001'),
  'Test Student', 'a profile row is created for the new user');
SELECT is((SELECT role FROM public.user_roles WHERE user_id = '90000000-0000-4000-8000-000000000001'),
  'default', 'new users start with the default role');

SELECT lives_ok(
  $$INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
    VALUES ('90000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'Mixed.Case@IIITKottayam.ac.in', '', now(), now())$$,
  'the domain check ignores letter case');

SELECT throws_ok(
  $$INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
    VALUES ('90000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'someone@gmail.com', '', now(), now())$$,
  'P0001', NULL, 'a non-college email is rejected');

SELECT throws_ok(
  $$INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
    VALUES ('90000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'a@iiitkottayam.ac.in.evil.com', '', now(), now())$$,
  'P0001', NULL, 'a look-alike suffix domain is rejected');

SELECT throws_ok(
  $$INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
    VALUES ('90000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'a@xiiitkottayam.ac.in', '', now(), now())$$,
  'P0001', NULL, 'a look-alike prefix domain is rejected');

SELECT throws_ok(
  $$INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
    VALUES ('90000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', NULL, '', now(), now())$$,
  'P0001', NULL, 'an account without an email is rejected');

SELECT throws_ok(
  $$UPDATE auth.users SET email = 'moved@gmail.com' WHERE id = '90000000-0000-4000-8000-000000000001'$$,
  'P0001', NULL, 'an existing account cannot be moved to a non-college email');

SELECT lives_ok(
  $$UPDATE auth.users SET email = 'renamed@iiitkottayam.ac.in' WHERE id = '90000000-0000-4000-8000-000000000001'$$,
  'an account can change to another college email');

-- Setting a password keeps the same user (no new row, same id)
SELECT lives_ok(
  $$UPDATE auth.users SET encrypted_password = crypt('a-long-test-password', gen_salt('bf'))
    WHERE id = '90000000-0000-4000-8000-000000000001'$$,
  'a password can be added to an existing account');
SELECT is((SELECT count(*) FROM auth.users WHERE id = '90000000-0000-4000-8000-000000000001')::int, 1, 'still exactly one user');
SELECT is((SELECT count(*) FROM public.user_profiles WHERE id = '90000000-0000-4000-8000-000000000001')::int, 1, 'profile row unchanged');

-- Existing fixture accounts are untouched
SELECT is((SELECT id::text FROM auth.users WHERE email = 'lamb@iiitkottayam.ac.in'),
  '60000000-0000-4000-8000-000000000001', 'seeded accounts keep their ids');

SELECT * FROM finish();
ROLLBACK;

-- Group: database. audit_actors lists every distinct actor in the whole audit history once, labelled by the sign-in
-- email of their account (which they cannot edit) with their real name or nickname as context; never a raw id. A
-- self-edited profile email or a copied name cannot make one person look like another. A deleted account is labelled
-- clearly, and nobody but a dictator gets rows. Rolled back.
BEGIN;
SELECT plan(12);

INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
SELECT ('aa000000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated',
       (ARRAY['aa.dictator','aa.named','aa.nick','aa.plain','aa.spoof','aa.copy','aa.noprofile'])[n] || '@iiitkottayam.ac.in', '', now(), now()
FROM generate_series(1, 7) AS n;
UPDATE public.user_roles SET role = 'dictator' WHERE user_id = 'aa000000-0000-4000-8000-000000000001';
UPDATE public.user_profiles SET real_name = 'Named Person' WHERE id = 'aa000000-0000-4000-8000-000000000002';
UPDATE public.user_profiles SET real_name = '  ', nickname = 'Nicky' WHERE id = 'aa000000-0000-4000-8000-000000000003';
UPDATE public.user_profiles SET real_name = E'\t\n ', nickname = NULL WHERE id = 'aa000000-0000-4000-8000-000000000004';
-- A user edits their own profile email to someone else's address, and another copies a name.
UPDATE public.user_profiles SET real_name = NULL, nickname = NULL, email = 'aa.named@iiitkottayam.ac.in' WHERE id = 'aa000000-0000-4000-8000-000000000005';
UPDATE public.user_profiles SET real_name = 'Named Person' WHERE id = 'aa000000-0000-4000-8000-000000000006';
DELETE FROM public.user_profiles WHERE id = 'aa000000-0000-4000-8000-000000000007';

-- Old history: these actors appear far beyond the first page of entries.
INSERT INTO public.audit_log (occurred_at, actor_id, actor_role, action, table_name, record_id)
SELECT now() - interval '1 year', ('aa000000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'update', 'divisions', 'x'
FROM generate_series(2, 7) AS n, generate_series(1, 3) AS copies;
INSERT INTO public.audit_log (occurred_at, actor_id, actor_role, action, table_name, record_id)
VALUES (now() - interval '2 years', 'aa000000-0000-4000-8000-0000000000ff', 'authenticated', 'update', 'divisions', 'gone'),
       (now() - interval '2 years', 'aa000000-0000-4000-8000-0000000000fe', 'authenticated', 'update', 'divisions', 'gone too');

CREATE FUNCTION pg_temp.as_user(p_uid uuid, p_sql text)
RETURNS SETOF record LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  RETURN QUERY EXECUTE p_sql;
  RESET ROLE;
END;
$$;
CREATE TEMP TABLE _seen AS
SELECT * FROM pg_temp.as_user('aa000000-0000-4000-8000-000000000001', 'SELECT actor_id, label, available FROM public.audit_actors()')
  AS t(actor_id uuid, label text, available boolean);
RESET ROLE;

SELECT is((SELECT label FROM _seen WHERE actor_id = 'aa000000-0000-4000-8000-000000000002'), 'Named Person (aa.named@iiitkottayam.ac.in)',
  'an actor from old history is listed by real name with their account email');
SELECT is((SELECT label FROM _seen WHERE actor_id = 'aa000000-0000-4000-8000-000000000003'), 'Nicky (aa.nick@iiitkottayam.ac.in)', 'a blank real name falls back to the nickname');
SELECT is((SELECT label FROM _seen WHERE actor_id = 'aa000000-0000-4000-8000-000000000004'), 'aa.plain@iiitkottayam.ac.in', 'a name of only tabs, newlines or spaces falls back to the email');
SELECT is((SELECT label FROM _seen WHERE actor_id = 'aa000000-0000-4000-8000-000000000005'), 'aa.spoof@iiitkottayam.ac.in', 'a self-edited profile email cannot borrow someone else''s address');
SELECT is((SELECT label FROM _seen WHERE actor_id = 'aa000000-0000-4000-8000-000000000006'), 'Named Person (aa.copy@iiitkottayam.ac.in)', 'a copied name stays distinguishable');
SELECT is((SELECT label FROM _seen WHERE actor_id = 'aa000000-0000-4000-8000-000000000007'), 'aa.noprofile@iiitkottayam.ac.in', 'an account without a profile is listed by its email');
SELECT is((SELECT count(*) FROM _seen WHERE actor_id::text LIKE 'aa000000-%')::int, 8, 'each person is listed once, however many changes they made');
-- The history is append-only, so other deleted accounts may already be in it: check the form and distinctness of the
-- labels, not which numbers they get.
SELECT is((SELECT count(*)::int FROM _seen WHERE actor_id::text LIKE 'aa000000-0000-4000-8000-0000000000f%'
           AND label ~ '^Deleted or unavailable account [0-9]+$' AND NOT available), 2, 'a deleted account is labelled clearly');
SELECT is((SELECT count(DISTINCT label)::int FROM _seen WHERE actor_id::text LIKE 'aa000000-0000-4000-8000-0000000000f%'), 2,
  'several deleted accounts stay distinguishable');
SELECT is((SELECT count(*) FROM _seen WHERE label ~ '^[0-9a-f]{8}-[0-9a-f]{4}-')::int, 0, 'no label is a raw id');
SELECT is((SELECT count(*) FROM pg_temp.as_user('aa000000-0000-4000-8000-000000000002', 'SELECT actor_id, label, available FROM public.audit_actors()')
           AS t(actor_id uuid, label text, available boolean))::int, 0, 'an account without the dictator role gets no rows');
RESET ROLE;
SELECT ok(NOT has_function_privilege('anon', 'public.audit_actors()', 'EXECUTE'), 'visitors cannot call it');

SELECT * FROM finish();
ROLLBACK;

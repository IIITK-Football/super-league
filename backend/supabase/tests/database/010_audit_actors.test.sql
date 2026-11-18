-- Group: database. audit_actors lists every distinct actor in the whole audit history with a readable label (real
-- name, else nickname, else email; never a raw id), labels a deleted account clearly, and returns nothing to anyone
-- but a dictator. Rolled back.
BEGIN;
SELECT plan(7);

INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
SELECT ('aa000000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated',
       (ARRAY['aa.dictator','aa.named','aa.nick','aa.plain'])[n] || '@iiitkottayam.ac.in', '', now(), now()
FROM generate_series(1, 4) AS n;
UPDATE public.user_roles SET role = 'dictator' WHERE user_id = 'aa000000-0000-4000-8000-000000000001';
UPDATE public.user_profiles SET real_name = 'Named Person' WHERE id = 'aa000000-0000-4000-8000-000000000002';
UPDATE public.user_profiles SET real_name = '  ', nickname = 'Nicky' WHERE id = 'aa000000-0000-4000-8000-000000000003';
UPDATE public.user_profiles SET real_name = NULL, nickname = NULL WHERE id = 'aa000000-0000-4000-8000-000000000004';

-- Old history: these actors appear far beyond the first page of entries.
INSERT INTO public.audit_log (occurred_at, actor_id, actor_role, action, table_name, record_id)
SELECT now() - interval '1 year', ('aa000000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'update', 'divisions', 'x'
FROM generate_series(2, 4) AS n;
INSERT INTO public.audit_log (occurred_at, actor_id, actor_role, action, table_name, record_id)
VALUES (now() - interval '2 years', 'aa000000-0000-4000-8000-0000000000ff', 'authenticated', 'update', 'divisions', 'gone');

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

SELECT is((SELECT label FROM _seen WHERE actor_id = 'aa000000-0000-4000-8000-000000000002'), 'Named Person', 'an actor from old history is listed by real name');
SELECT is((SELECT label FROM _seen WHERE actor_id = 'aa000000-0000-4000-8000-000000000003'), 'Nicky', 'a blank real name falls back to the nickname');
SELECT is((SELECT label FROM _seen WHERE actor_id = 'aa000000-0000-4000-8000-000000000004'), 'aa.plain@iiitkottayam.ac.in', 'no name falls back to the email');
SELECT results_eq($$SELECT label, available FROM _seen WHERE actor_id = 'aa000000-0000-4000-8000-0000000000ff'$$,
  $$VALUES ('Deleted or unavailable account'::text, false)$$, 'a deleted account is labelled clearly');
SELECT is((SELECT count(*) FROM _seen WHERE label ~ '^[0-9a-f]{8}-[0-9a-f]{4}-')::int, 0, 'no label is a raw id');
SELECT is((SELECT count(*) FROM pg_temp.as_user('aa000000-0000-4000-8000-000000000002', 'SELECT actor_id, label, available FROM public.audit_actors()')
           AS t(actor_id uuid, label text, available boolean))::int, 0, 'an account without the dictator role gets no rows');
RESET ROLE;
SELECT ok(NOT has_function_privilege('anon', 'public.audit_actors()', 'EXECUTE'), 'visitors cannot call it');

SELECT * FROM finish();
ROLLBACK;

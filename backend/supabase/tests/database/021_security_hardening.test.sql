-- SL-025 security hardening: anonymous callers hold no write privilege on any public table; signed-in callers hold no
-- TRUNCATE, REFERENCES or TRIGGER; future objects default to the same; RLS is on everywhere; definer functions pin
-- search_path and trigger-only functions are not callable; user_profiles hides email and allows only own-row updates of
-- the permitted columns; teams and newsletter are audited.
begin;
select plan(21);

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')),
  0, 'anon holds no write, truncate, references or trigger privilege on any public table');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated' and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER')),
  0, 'signed-in callers hold no TRUNCATE, REFERENCES or TRIGGER on any public table');

select is(
  (select count(*)::int from pg_default_acl d, aclexplode(d.defaclacl) a
    where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'
      and a.grantee = 'anon'::regrole and a.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')),
  0, 'tables created later by postgres give anon no write privilege');

select is(
  (select count(*)::int from pg_default_acl d, aclexplode(d.defaclacl) a
    where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'f'
      and a.grantee in (0, 'anon'::regrole) and a.privilege_type = 'EXECUTE'),
  0, 'functions created later by postgres are not executable by PUBLIC or anon by default');

select is(
  (select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity),
  0, 'row level security is on for every public table');

select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  0, 'every security-definer function pins its search_path');

select ok(
  (select bool_and(exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%pg_temp'))
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('handle_new_user', 'enforce_college_domain')),
  'the sign-up triggers resolve names with pg_temp last');

select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('handle_new_user', 'enforce_college_domain', 'match_events_before_write', 'match_events_after_write')
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0, 'trigger-only definer functions cannot be called through the API');

select ok(has_function_privilege('anon', 'public.season_fantasy_leaderboard(uuid, integer)', 'EXECUTE'),
  'the public fantasy leaderboard stays callable by visitors');

select ok(not has_column_privilege('anon', 'public.user_profiles', 'email', 'SELECT'), 'visitors cannot read profile emails');
select ok(not has_column_privilege('authenticated', 'public.user_profiles', 'email', 'SELECT'), 'signed-in users cannot read profile emails');
select ok(has_column_privilege('anon', 'public.user_profiles', 'nickname', 'SELECT'), 'nicknames stay public');
select ok(not has_column_privilege('authenticated', 'public.user_profiles', 'email', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.user_profiles', 'id', 'UPDATE'),
  'users cannot change a profile email or id');
select ok(has_column_privilege('authenticated', 'public.user_profiles', 'wc_team_flair', 'UPDATE'), 'users can still set their World Cup flair');

select is(
  (select pg_get_expr(polwithcheck, polrelid) from pg_policy where polrelid = 'public.user_profiles'::regclass and polcmd = 'w'),
  '(auth.uid() = id)', 'the own-profile update policy checks the new row too');

select ok(exists (select 1 from pg_trigger where tgrelid = 'public.teams'::regclass and tgname = 'audit_teams'), 'team changes are audited');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.newsletter'::regclass and tgname = 'audit_newsletter'), 'newsletter changes are audited');

-- The current schema's sensitive tables use the same enabled AFTER ROW audit trigger.
select is(
  (select array_agg(required.name order by required.name)
     from unnest(array[
       'captain_assignments', 'divisions', 'match_events', 'matches', 'newsletter',
       'player_link_keys', 'players', 'roster_memberships', 'scorer_assignments',
       'season_sections', 'seasons', 'section_types', 'team_entries', 'teams', 'user_profiles', 'user_roles'
     ]) as required(name)
    where not exists (
      select 1 from pg_trigger t
       where t.tgrelid = to_regclass('public.' || required.name)
         and t.tgfoid = 'public.audit_row_change()'::regprocedure
         and t.tgenabled in ('O', 'A')
         and t.tgtype = 29
    )),
  null::text[], 'all sensitive tables record inserts, updates and deletes');

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values ('d2500000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
        'sl025.audit@iiitkottayam.ac.in', '', now(), now());

update public.user_profiles set nickname = 'Audit example', email = 'sl025.updated@iiitkottayam.ac.in'
where id = 'd2500000-0000-4000-8000-000000000001';

delete from public.user_profiles where id = 'd2500000-0000-4000-8000-000000000001';

select is(
  (select changes ->> 'email' from public.audit_log
    where table_name = 'user_profiles' and record_id = 'd2500000-0000-4000-8000-000000000001' and action = 'insert'),
  '[redacted]', 'profile creation redacts email');

select ok(exists (
  select 1 from public.audit_log
   where table_name = 'user_profiles' and record_id = 'd2500000-0000-4000-8000-000000000001'
     and action = 'update' and changes -> 'email' = '{"changed":true}'::jsonb
     and changes -> 'nickname' ->> 'to' = 'Audit example'
), 'profile updates record public changes and omit email values');

select is(
  (select changes ->> 'email' from public.audit_log
    where table_name = 'user_profiles' and record_id = 'd2500000-0000-4000-8000-000000000001' and action = 'delete'),
  '[redacted]', 'profile removal redacts email');

select * from finish();
rollback;

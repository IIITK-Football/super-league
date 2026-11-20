-- Security hardening of the final Phase 2 schema (SL-025). Forward-only; no data changes.
--
-- 1. Anonymous callers never write: every INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER privilege on public
--    tables is revoked from anon (no policy ever let anon write; this removes the privilege itself).
-- 2. Signed-in callers keep SELECT/INSERT/UPDATE/DELETE (row level security still decides each row) but lose TRUNCATE
--    (which bypasses RLS), REFERENCES and TRIGGER.
-- 3. The same defaults apply to tables and functions created later by postgres: no anon writes, no TRUNCATE, and no
--    EXECUTE for PUBLIC or anon unless a migration grants it explicitly. (supabase_admin's defaults cannot be changed
--    from here; the per-object checks in the tests cover their effect.)
-- 4. Security-definer functions: the sign-up triggers pin search_path with pg_temp last, and trigger-only functions
--    are not executable by API callers (triggers do not need EXECUTE to fire).
-- 5. user_profiles: email is no longer readable by anyone through the Data API (column privileges); a user can update
--    only their own row and only nickname, real name and flairs, never id or email.
-- 6. teams and newsletter changes are recorded in the audit history like the other managed tables.

-- 1 and 2 -------------------------------------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;

-- 3 -----------------------------------------------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

-- 4 -----------------------------------------------------------------------------------------------------------------
ALTER FUNCTION public.handle_new_user() SET search_path = public, pg_temp;
ALTER FUNCTION public.enforce_college_domain() SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_college_domain() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_events_before_write() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_events_after_write() FROM PUBLIC, anon, authenticated;

-- 5 -----------------------------------------------------------------------------------------------------------------
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.user_profiles FROM anon, authenticated;
GRANT SELECT (id, real_name, nickname, team_flair_id, wc_team_flair, created_at) ON public.user_profiles TO anon, authenticated;
-- A profile row is created by the sign-up trigger (handle_new_user); a missing one may be created by its owner,
-- without an email (the email is the Auth account's and is never set through the Data API).
GRANT INSERT (id, real_name, nickname, team_flair_id, wc_team_flair) ON public.user_profiles TO authenticated;
GRANT UPDATE (real_name, nickname, team_flair_id, wc_team_flair) ON public.user_profiles TO authenticated;

DROP POLICY IF EXISTS "Users can update own profile." ON public.user_profiles;
CREATE POLICY "Users can update own profile." ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.user_profiles;
CREATE POLICY "Users can insert their own profile" ON public.user_profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- 6 -----------------------------------------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS audit_teams ON public.teams;
CREATE TRIGGER audit_teams AFTER INSERT OR DELETE OR UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
DROP TRIGGER IF EXISTS audit_newsletter ON public.newsletter;
CREATE TRIGGER audit_newsletter AFTER INSERT OR DELETE OR UPDATE ON public.newsletter
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

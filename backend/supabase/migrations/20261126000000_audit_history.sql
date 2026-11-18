-- Append-only audit history for sensitive changes.
--
-- * public.audit_log: one row per changed record: when, who (auth.uid() and the request role, or the database
--   session for server, seed and migration work), what (insert / update / delete), which table and record, and a safe
--   summary: an insert or delete lists the record's values, an update lists only the changed fields as from -> to.
--   Private contact fields are never written: they appear only as "[redacted]" / {"changed": true}.
-- * public.audit_row_change(): one AFTER ROW trigger function, so direct Data API writes, RPCs and API routes are all
--   recorded. Attached now to division and season configuration, roles, team registrations (captain assignments),
--   match scores and goals, and players and season rosters. Later slices attach it to their own tables.
-- * Nobody changes history: anon and signed-in users have no write privilege, and a trigger refuses any UPDATE,
--   DELETE or TRUNCATE on the table for every role, the server key included. Only dictators read it.
-- Forward-only.

CREATE TABLE public.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  -- No foreign key: deleting an account must not erase what it did.
  actor_id uuid,
  actor_role text NOT NULL,
  action text NOT NULL CONSTRAINT audit_log_action CHECK (action IN ('insert', 'update', 'delete')),
  table_name text NOT NULL,
  record_id text,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_log_occurred_at_idx ON public.audit_log (occurred_at DESC, id DESC);
CREATE INDEX audit_log_table_idx ON public.audit_log (table_name, occurred_at DESC);
CREATE INDEX audit_log_actor_idx ON public.audit_log (actor_id, occurred_at DESC);
COMMENT ON TABLE public.audit_log IS 'Append-only history of sensitive changes: actor, action, table, record and a safe before/after summary. Dictators read it; nobody can change it.';

-- Trigger arguments (all optional, comma-separated column names):
--   TG_ARGV[0] key columns that identify the record (default: id)
--   TG_ARGV[1] private columns: never written, only marked as changed or present
--   TG_ARGV[2] noise columns: ignored (an update touching only these is not recorded)
CREATE FUNCTION public.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_new jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_row jsonb := COALESCE(v_new, v_old);
  v_keys text[] := string_to_array(COALESCE(NULLIF(TG_ARGV[0], ''), 'id'), ',');
  v_private text[] := COALESCE(string_to_array(NULLIF(TG_ARGV[1], ''), ','), '{}');
  v_noise text[] := COALESCE(string_to_array(NULLIF(TG_ARGV[2], ''), ','), '{}') || ARRAY['created_at', 'updated_at'];
  v_changes jsonb := '{}'::jsonb;
  v_claims jsonb;
  v_key text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      CONTINUE WHEN v_key = ANY (v_noise) OR (v_new -> v_key) IS NOT DISTINCT FROM (v_old -> v_key);
      v_changes := v_changes || jsonb_build_object(v_key,
        CASE WHEN v_key = ANY (v_private) THEN jsonb_build_object('changed', true)
             ELSE jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key) END);
    END LOOP;
    IF v_changes = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
  ELSE
    FOR v_key IN SELECT jsonb_object_keys(v_row) LOOP
      CONTINUE WHEN v_key = ANY (v_noise);
      v_changes := v_changes || jsonb_build_object(v_key,
        CASE WHEN v_key = ANY (v_private) AND jsonb_typeof(v_row -> v_key) <> 'null' THEN to_jsonb('[redacted]'::text)
             ELSE v_row -> v_key END);
    END LOOP;
  END IF;

  BEGIN
    v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    v_claims := NULL;
  END;

  INSERT INTO public.audit_log (actor_id, actor_role, action, table_name, record_id, changes)
  VALUES (
    auth.uid(),
    COALESCE(v_claims ->> 'role', session_user::text),
    lower(TG_OP),
    TG_TABLE_NAME,
    (SELECT string_agg(v_row ->> k, ':' ORDER BY ord) FROM unnest(v_keys) WITH ORDINALITY AS u(k, ord)),
    v_changes
  );
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.audit_row_change() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.audit_row_change() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.audit_log_is_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  RAISE EXCEPTION 'Audit history cannot be changed or removed' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION public.audit_log_is_append_only() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_is_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON public.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_log_is_append_only();

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dictators read the audit history" ON public.audit_log FOR SELECT TO authenticated USING (public.is_dictator());
REVOKE ALL ON public.audit_log FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_log FROM authenticated, service_role;
GRANT SELECT ON public.audit_log TO authenticated, service_role;

-- Audited tables ----------------------------------------------------------------------------------------------
-- Division and season configuration
CREATE TRIGGER audit_divisions AFTER INSERT OR UPDATE OR DELETE ON public.divisions
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_seasons AFTER INSERT OR UPDATE OR DELETE ON public.seasons
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_season_sections AFTER INSERT OR UPDATE OR DELETE ON public.season_sections
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('season_id,section_key');
CREATE TRIGGER audit_section_types AFTER INSERT OR UPDATE OR DELETE ON public.section_types
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('key');
CREATE TRIGGER audit_team_entries AFTER INSERT OR UPDATE OR DELETE ON public.team_entries
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
-- Roles and captain assignments (team registrations)
CREATE TRIGGER audit_user_roles AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('user_id');
CREATE TRIGGER audit_team_registrations AFTER INSERT OR UPDATE OR DELETE ON public.team_registrations
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
-- Match scores and events (the running clock is not a sensitive change)
CREATE TRIGGER audit_matches AFTER INSERT OR UPDATE OR DELETE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('id', '', 'minute,timer_start_time,timer_calibration');
CREATE TRIGGER audit_goals AFTER INSERT OR UPDATE OR DELETE ON public.goals
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
-- Players and season rosters (the contact email is private)
CREATE TRIGGER audit_players AFTER INSERT OR UPDATE OR DELETE ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_roster_memberships AFTER INSERT OR UPDATE OR DELETE ON public.roster_memberships
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_player_private_details AFTER INSERT OR UPDATE OR DELETE ON public.player_private_details
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('player_id', 'email');

-- Five roles with scoped captain and scorer assignments (D-03 and its 2026-11-20 addendum).
--
-- * Roles are independent grants: captain, scorer, editor, dictator. A normal user holds none, so the stored 'default'
--   rows are removed and a new account gets no row. No role implies another.
-- * Captain and scorer powers need a scoped assignment on top of the grant:
--   - captain_assignments: one captain per team entry (UNIQUE (team_entry_id)); a person may captain several entries;
--     the assignment is writable while its season is current or upcoming (planned/registration) and not completed or
--     archived;
--   - scorer_assignments: scoped to one season or one match, with an optional expiry.
-- * team_registrations is backfilled into captain_assignments and snapshotted whole into legacy_team_registrations
--   (it is dropped by the next migration, after every caller is ported); teams.name stays authoritative.
-- * Writes to matches, goals, teams, news, grants and assignments are limited to the roles that own them.
--
-- One transaction: it stops on the first failed guard and changes nothing.

-- Guards -------------------------------------------------------------------------------------------------------------
-- role-migration-guard:start
DO $$
DECLARE
  n integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    RAISE EXCEPTION 'legacy admin grants remain (20261130000000 should have removed them); nothing was changed';
  END IF;
  SELECT count(*) INTO n FROM public.team_registrations r
  WHERE r.team_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.team_entries e WHERE e.team_id = r.team_id AND e.season_id = r.season_id);
  IF n > 0 THEN
    RAISE EXCEPTION '% team registration(s) have no team entry (no team, or the team is not entered in the season); nothing was changed', n;
  END IF;
  SELECT count(*) INTO n FROM (
    SELECT r.team_id, r.season_id FROM public.team_registrations r GROUP BY 1, 2 HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION '% team entr(ies) have more than one registration, so they would have two captains; nothing was changed', n;
  END IF;
END;
$$;
-- role-migration-guard:end

-- Snapshot of the per-role counts, checked after the conversion.
CREATE TEMP TABLE _role_counts ON COMMIT DROP AS
  SELECT role, count(*) AS n FROM public.user_roles WHERE role IN ('captain', 'editor', 'dictator') GROUP BY role;
CREATE TEMP TABLE _default_count ON COMMIT DROP AS SELECT count(*) AS n FROM public.user_roles WHERE role = 'default';

-- Grants -------------------------------------------------------------------------------------------------------------
DROP TRIGGER audit_user_roles ON public.user_roles;
DROP TRIGGER on_auth_user_role_created ON auth.users;
DROP FUNCTION public.handle_new_user_role();

DROP POLICY "Dictators manage roles" ON public.user_roles;
DROP POLICY "Users can read their own role" ON public.user_roles;

DELETE FROM public.user_roles WHERE role = 'default';
ALTER TABLE public.user_roles DROP CONSTRAINT user_roles_role_check;
ALTER TABLE public.user_roles DROP CONSTRAINT user_roles_pkey;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role);
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_role_check CHECK (role IN ('captain', 'scorer', 'editor', 'dictator'));
ALTER TABLE public.user_roles ADD COLUMN granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.user_roles ADD COLUMN granted_at timestamptz NOT NULL DEFAULT now();
COMMENT ON TABLE public.user_roles IS 'Independent role grants (captain, scorer, editor, dictator). A normal user has none. Captain and scorer powers also need an assignment.';

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT c.role, c.n, (SELECT count(*) FROM public.user_roles u WHERE u.role = c.role) AS now_n FROM _role_counts c LOOP
    IF r.n <> r.now_n THEN
      RAISE EXCEPTION 'role % count changed from % to %; nothing was changed', r.role, r.n, r.now_n;
    END IF;
  END LOOP;
  -- A dictator count that was positive cannot have dropped to zero: the per-role comparison above already covers it.
  -- One summary row: the default rows are not a privilege, so they were removed without a row each.
  INSERT INTO public.audit_log (actor_id, actor_role, action, table_name, record_id, changes)
  SELECT NULL, 'migration', 'delete', 'user_roles', 'default', jsonb_build_object('removed_default_rows', n) FROM _default_count;
END;
$$;

-- Assignment tables --------------------------------------------------------------------------------------------------
CREATE TABLE public.captain_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_entry_id uuid NOT NULL REFERENCES public.team_entries(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT captain_assignments_one_per_entry UNIQUE (team_entry_id)
);
CREATE INDEX captain_assignments_user_idx ON public.captain_assignments (user_id);
COMMENT ON TABLE public.captain_assignments IS 'The one captain of a team entry (a team in a season). A person may captain several entries.';

CREATE TABLE public.scorer_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  season_id uuid REFERENCES public.seasons(id) ON DELETE CASCADE,
  match_id uuid REFERENCES public.matches(id) ON DELETE CASCADE,
  expires_at timestamptz,
  assigned_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scorer_assignments_one_scope CHECK (num_nonnulls(season_id, match_id) = 1)
);
CREATE UNIQUE INDEX scorer_assignments_season_key ON public.scorer_assignments (user_id, season_id) WHERE season_id IS NOT NULL;
CREATE UNIQUE INDEX scorer_assignments_match_key ON public.scorer_assignments (user_id, match_id) WHERE match_id IS NOT NULL;
COMMENT ON TABLE public.scorer_assignments IS 'A scorer''s scope: every match of one season, or one match, with an optional expiry.';

ALTER TABLE public.captain_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scorer_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own or dictator captain assignments" ON public.captain_assignments FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_dictator());
CREATE POLICY "Dictators manage captain assignments" ON public.captain_assignments TO authenticated
  USING (public.is_dictator()) WITH CHECK (public.is_dictator());
CREATE POLICY "Read own or dictator scorer assignments" ON public.scorer_assignments FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_dictator());
CREATE POLICY "Dictators manage scorer assignments" ON public.scorer_assignments TO authenticated
  USING (public.is_dictator()) WITH CHECK (public.is_dictator());
REVOKE ALL ON public.captain_assignments, public.scorer_assignments FROM anon;
REVOKE TRUNCATE ON public.captain_assignments, public.scorer_assignments FROM authenticated;

CREATE POLICY "Read own roles or dictator" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_dictator());
CREATE POLICY "Dictators manage roles" ON public.user_roles TO authenticated
  USING (public.is_dictator()) WITH CHECK (public.is_dictator());

-- Helpers ------------------------------------------------------------------------------------------------------------
-- Writable season: not archived, not completed, and current or upcoming (D-03 addendum).
CREATE FUNCTION public.season_is_writable(p_season uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $$
  SELECT COALESCE((SELECT s.archived_at IS NULL AND s.status <> 'completed' AND (s.is_current OR s.status IN ('planned', 'registration'))
                   FROM public.seasons s WHERE s.id = p_season), false)
$$;

CREATE FUNCTION public.has_role(p_role text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = p_role)
$$;

CREATE FUNCTION public.my_roles()
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $$
  SELECT COALESCE(array_agg(role ORDER BY role), '{}') FROM public.user_roles WHERE user_id = auth.uid()
$$;

-- The caller holds the captain grant and a writable assignment on exactly this team entry. A dictator is checked
-- separately by callers (dictator precedence).
CREATE FUNCTION public.is_captain_of(p_entry uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $$
  SELECT public.has_role('captain') AND EXISTS (
    SELECT 1 FROM public.captain_assignments ca
    JOIN public.team_entries e ON e.id = ca.team_entry_id
    WHERE ca.team_entry_id = p_entry AND ca.user_id = auth.uid() AND public.season_is_writable(e.season_id))
$$;

-- A dictator, or a scorer with the grant and an unexpired assignment to the match or its season.
CREATE FUNCTION public.can_score(p_match uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $$
  SELECT public.is_dictator() OR (
    public.has_role('scorer') AND EXISTS (
      SELECT 1 FROM public.scorer_assignments sa JOIN public.matches m ON m.id = p_match
      WHERE sa.user_id = auth.uid() AND (sa.expires_at IS NULL OR sa.expires_at > now())
        AND (sa.match_id = m.id OR sa.season_id = m.season_id)))
$$;

CREATE FUNCTION public.scorable_match_ids(p_ids uuid[])
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $$
  SELECT id FROM unnest(p_ids) AS id WHERE public.can_score(id)
$$;

REVOKE ALL ON FUNCTION public.season_is_writable(uuid), public.has_role(text), public.my_roles(), public.is_captain_of(uuid),
  public.can_score(uuid), public.scorable_match_ids(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.season_is_writable(uuid), public.has_role(text), public.my_roles(), public.is_captain_of(uuid),
  public.can_score(uuid), public.scorable_match_ids(uuid[]) TO authenticated, service_role;

-- Backfill: every registration becomes the assignment of its team entry ---------------------------------------------
INSERT INTO public.captain_assignments (team_entry_id, user_id, assigned_by, assigned_at)
SELECT e.id, r.captain_id, NULL, r.created_at
FROM public.team_registrations r
JOIN public.team_entries e ON e.team_id = r.team_id AND e.season_id = r.season_id;

-- A full snapshot of every registration, kept as history when team_registrations is retired (the next migration
-- refuses to drop it unless every row is here). registration_name is the name the registration carried; teams.name
-- stays authoritative and is never overwritten, so a differing name is only reported (a dictator or the captain
-- renames the team deliberately).
CREATE TABLE public.legacy_team_registrations (
  registration_id uuid PRIMARY KEY,
  captain_id uuid,
  team_id uuid,
  season_id uuid,
  registration_name text NOT NULL,
  team_name text,
  registered_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.legacy_team_registrations IS 'Snapshot of team_registrations at its retirement: who captained which team in which season, and the name the registration carried. Captain assignments are the live data; this is history.';
ALTER TABLE public.legacy_team_registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dictators read registration history" ON public.legacy_team_registrations FOR SELECT TO authenticated USING (public.is_dictator());
REVOKE ALL ON public.legacy_team_registrations FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.legacy_team_registrations FROM authenticated;
INSERT INTO public.legacy_team_registrations (registration_id, captain_id, team_id, season_id, registration_name, team_name, registered_at)
SELECT r.id, r.captain_id, r.team_id, r.season_id, r.team_name, t.name, r.created_at
FROM public.team_registrations r LEFT JOIN public.teams t ON t.id = r.team_id;

DO $$
DECLARE
  n_reg integer;
  n_asg integer;
  n_mismatch integer;
BEGIN
  SELECT count(*) INTO n_reg FROM public.team_registrations;
  SELECT count(*) INTO n_asg FROM public.captain_assignments;
  IF n_reg <> n_asg THEN
    RAISE EXCEPTION '% registrations but % captain assignments; nothing was changed', n_reg, n_asg;
  END IF;
  SELECT count(*) INTO n_mismatch FROM public.team_registrations r
  WHERE NOT EXISTS (SELECT 1 FROM public.captain_assignments ca JOIN public.team_entries e ON e.id = ca.team_entry_id
                    WHERE ca.user_id = r.captain_id AND e.team_id = r.team_id AND e.season_id = r.season_id);
  IF n_mismatch > 0 THEN
    RAISE EXCEPTION '% registrations have no identical captain assignment; nothing was changed', n_mismatch;
  END IF;
  RAISE NOTICE 'captain assignments created: %; registrations whose name differs from the team name: %', n_asg, (SELECT count(*) FROM public.legacy_team_registrations WHERE registration_name IS DISTINCT FROM team_name);
END;
$$;

-- Last dictator ------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.keep_one_dictator()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF OLD.role = 'dictator' AND (TG_OP = 'DELETE' OR NEW.role <> 'dictator' OR NEW.user_id <> OLD.user_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'dictator' AND user_id <> OLD.user_id) THEN
      RAISE EXCEPTION 'The last dictator grant cannot be removed';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER user_roles_keep_one_dictator BEFORE UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.keep_one_dictator();

-- Dictator RPCs (SECURITY INVOKER: the policies above also apply) -------------------------------------------------
-- Removes the captain grant when the person no longer has a writable captain assignment. Other grants are untouched.
CREATE FUNCTION public.refresh_captain_grants(p_user uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  n integer;
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can change role grants' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.user_roles ur
  WHERE ur.role = 'captain'
    AND (ur.user_id = p_user
         -- With no person given, only people who hold assignments are considered, so a captain grant that has no
         -- assignment yet (just granted, not yet assigned) is never removed as a side effect of a season change.
         OR (p_user IS NULL AND EXISTS (SELECT 1 FROM public.captain_assignments any_ca WHERE any_ca.user_id = ur.user_id)))
    AND NOT EXISTS (
      SELECT 1 FROM public.captain_assignments ca JOIN public.team_entries e ON e.id = ca.team_entry_id
      WHERE ca.user_id = ur.user_id AND public.season_is_writable(e.season_id));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

CREATE FUNCTION public.assign_captain(p_entry uuid, p_user uuid, p_replace boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  v_season uuid;
  v_id uuid;
  v_prev uuid;
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can assign captains' USING ERRCODE = '42501';
  END IF;
  SELECT season_id INTO v_season FROM public.team_entries WHERE id = p_entry;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team entry not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.season_is_writable(v_season) THEN
    RAISE EXCEPTION 'A captain cannot be assigned in a completed or archived season' USING ERRCODE = '22023';
  END IF;

  SELECT id, user_id INTO v_id, v_prev FROM public.captain_assignments WHERE team_entry_id = p_entry;
  IF FOUND THEN
    IF v_prev = p_user THEN
      RETURN v_id;
    END IF;
    IF NOT p_replace THEN
      RAISE EXCEPTION 'This team already has a captain' USING ERRCODE = '23505';
    END IF;
  END IF;

  -- The foreign keys check that the account exists (this function runs as the caller and cannot read auth.users).
  BEGIN
    IF v_id IS NOT NULL THEN
      UPDATE public.captain_assignments SET user_id = p_user, assigned_by = auth.uid(), assigned_at = now() WHERE id = v_id;
    ELSE
      INSERT INTO public.captain_assignments (team_entry_id, user_id) VALUES (p_entry, p_user) RETURNING id INTO v_id;
    END IF;
    INSERT INTO public.user_roles (user_id, role, granted_by) VALUES (p_user, 'captain', auth.uid()) ON CONFLICT DO NOTHING;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'Account not found' USING ERRCODE = 'P0002';
  END;
  IF v_prev IS NOT NULL THEN
    PERFORM public.refresh_captain_grants(v_prev);
  END IF;
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.revoke_captain(p_entry uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  v_user uuid;
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can revoke captains' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.captain_assignments WHERE team_entry_id = p_entry RETURNING user_id INTO v_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This team has no captain' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.refresh_captain_grants(v_user);
END;
$$;

CREATE FUNCTION public.assign_scorer(p_user uuid, p_season uuid, p_match uuid, p_expires_at timestamptz DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can assign scorers' USING ERRCODE = '42501';
  END IF;
  IF num_nonnulls(p_season, p_match) <> 1 THEN
    RAISE EXCEPTION 'Choose either a season or one match' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'The expiry must be in the future' USING ERRCODE = '22023';
  END IF;
  BEGIN
    INSERT INTO public.scorer_assignments (user_id, season_id, match_id, expires_at)
    VALUES (p_user, p_season, p_match, p_expires_at) RETURNING id INTO v_id;
    INSERT INTO public.user_roles (user_id, role, granted_by) VALUES (p_user, 'scorer', auth.uid()) ON CONFLICT DO NOTHING;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'This scorer already has that assignment' USING ERRCODE = '23505';
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'Account, season or match not found' USING ERRCODE = 'P0002';
  END;
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.revoke_scorer(p_assignment uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  v_user uuid;
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can revoke scorers' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.scorer_assignments WHERE id = p_assignment RETURNING user_id INTO v_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found' USING ERRCODE = 'P0002';
  END IF;
  -- The grant goes with the last assignment that can still score.
  IF NOT EXISTS (SELECT 1 FROM public.scorer_assignments WHERE user_id = v_user AND (expires_at IS NULL OR expires_at > now())) THEN
    DELETE FROM public.user_roles WHERE user_id = v_user AND role = 'scorer';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_captain_grants(uuid), public.assign_captain(uuid, uuid, boolean), public.revoke_captain(uuid),
  public.assign_scorer(uuid, uuid, uuid, timestamptz), public.revoke_scorer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_captain_grants(uuid), public.assign_captain(uuid, uuid, boolean), public.revoke_captain(uuid),
  public.assign_scorer(uuid, uuid, uuid, timestamptz), public.revoke_scorer(uuid) TO authenticated, service_role;

-- Switching the current season can make the old current season read-only for its captains: lapse their grants.
CREATE OR REPLACE FUNCTION public.set_current_season(p_season uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_division uuid;
  v_archived timestamptz;
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can change the current season' USING ERRCODE = '42501';
  END IF;

  SELECT division_id, archived_at INTO v_division, v_archived FROM public.seasons WHERE id = p_season;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Season not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'An archived season cannot be current; restore it first' USING ERRCODE = '22023';
  END IF;

  UPDATE public.seasons SET is_current = false WHERE division_id = v_division AND is_current AND id <> p_season;
  UPDATE public.seasons SET is_current = true WHERE id = p_season;
  PERFORM public.refresh_captain_grants();
END;
$$;

-- Policies -----------------------------------------------------------------------------------------------------------
-- Matches: dictators manage; an assigned scorer updates. The teams, the season and the date of a fixture stay with
-- dictators (a scorer owns the result, not the schedule).
DROP POLICY "Allow authenticated deletes on matches" ON public.matches;
DROP POLICY "Allow authenticated inserts on matches" ON public.matches;
DROP POLICY "Allow authenticated updates on matches" ON public.matches;
CREATE POLICY "Scorers update assigned matches" ON public.matches FOR UPDATE TO authenticated
  USING (public.can_score(id)) WITH CHECK (public.can_score(id));

CREATE FUNCTION public.scorers_keep_the_fixture()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF (NEW.home_team_id IS DISTINCT FROM OLD.home_team_id OR NEW.away_team_id IS DISTINCT FROM OLD.away_team_id
      OR NEW.season_id IS DISTINCT FROM OLD.season_id OR NEW.date IS DISTINCT FROM OLD.date OR NEW.venue IS DISTINCT FROM OLD.venue)
     AND NOT public.is_dictator() AND current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'Only a dictator can change the teams, season, date or venue of a match' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER matches_scorers_keep_the_fixture BEFORE UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.scorers_keep_the_fixture();

DROP POLICY "Allow authenticated deletes on goals" ON public.goals;
DROP POLICY "Allow authenticated inserts on goals" ON public.goals;
DROP POLICY "Allow authenticated updates on goals" ON public.goals;
CREATE POLICY "Dictators and scorers manage goals" ON public.goals TO authenticated
  USING (public.can_score(match_id)) WITH CHECK (public.can_score(match_id));

-- Teams: dictators only. A captain changes the team's details through the API route, which validates them first.
DROP POLICY "Allow authenticated deletes on teams" ON public.teams;
DROP POLICY "Allow authenticated inserts on teams" ON public.teams;
DROP POLICY "Allow authenticated updates on teams" ON public.teams;
CREATE POLICY "Dictators manage teams" ON public.teams TO authenticated
  USING (public.is_dictator()) WITH CHECK (public.is_dictator());
DROP TRIGGER check_captain_team_creation ON public.teams;
DROP FUNCTION public.enforce_team_logo_and_color();

-- News: editors and dictators publish and edit; only dictators delete (the existing dictator policy covers it).
DROP POLICY "Allow authenticated deletes on newsletter" ON public.newsletter;
DROP POLICY "Allow authenticated inserts on newsletter" ON public.newsletter;
DROP POLICY "Allow authenticated updates on newsletter" ON public.newsletter;
CREATE POLICY "Editors publish newsletter" ON public.newsletter FOR INSERT TO authenticated
  WITH CHECK (public.has_role('editor'));
CREATE POLICY "Editors edit newsletter" ON public.newsletter FOR UPDATE TO authenticated
  USING (public.has_role('editor')) WITH CHECK (public.has_role('editor'));

-- Roster edits by captains: the grant plus a writable assignment on the place's exact team entry ----------------------
CREATE OR REPLACE FUNCTION public.captain_update_roster_player(
  p_membership_id uuid,
  p_position text,
  p_jersey_number integer,
  p_overall_rating integer,
  p_attributes jsonb,
  p_image_url text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_dictator boolean;
  v_is_captain boolean;
  v_player uuid;
  v_entry uuid;
  v_season uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in';
  END IF;
  IF p_position IS NOT NULL AND p_position NOT IN
     ('GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'CF', 'ST') THEN
    RAISE EXCEPTION 'Choose a valid player position';
  END IF;
  IF p_jersey_number IS NOT NULL AND p_jersey_number NOT BETWEEN 0 AND 99 THEN
    RAISE EXCEPTION 'Jersey number must be between 0 and 99';
  END IF;
  -- Not set is allowed; a rating that is set must be 1..99. Nothing is filled in.
  IF p_overall_rating IS NOT NULL AND p_overall_rating NOT BETWEEN 1 AND 99 THEN
    RAISE EXCEPTION 'Overall rating must be between 1 and 99';
  END IF;
  IF jsonb_typeof(p_attributes) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Player attributes must be an object';
  END IF;

  v_is_dictator := public.is_dictator();
  v_is_captain := public.has_role('captain');

  SELECT rm.player_id, rm.team_entry_id, rm.season_id INTO v_player, v_entry, v_season
  FROM public.roster_memberships rm
  WHERE rm.id = p_membership_id;

  -- The roster place must be on the exact team entry the caller is assigned to. A missing place and someone else's
  -- place give the same error, so callers cannot discover which exist.
  IF NOT FOUND OR (NOT v_is_dictator AND NOT EXISTS (
       SELECT 1 FROM public.captain_assignments ca WHERE ca.team_entry_id = v_entry AND ca.user_id = v_uid)) THEN
    RAISE EXCEPTION 'Player is not part of your assigned roster';
  END IF;
  IF NOT v_is_dictator AND NOT v_is_captain THEN
    RAISE EXCEPTION 'Captain access is required to update players';
  END IF;
  -- The card is shared by every season; a captain edits it only through a current or upcoming season's roster.
  IF NOT v_is_dictator AND NOT public.season_is_writable(v_season) THEN
    RAISE EXCEPTION 'Only a current or upcoming season''s roster can be edited by its captain';
  END IF;

  BEGIN
    UPDATE public.roster_memberships SET position = p_position, jersey_number = p_jersey_number WHERE id = p_membership_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Jersey number % is already taken on this team', p_jersey_number;
  END;
  UPDATE public.players
  SET overall_rating = p_overall_rating, attributes = p_attributes, image_url = p_image_url
  WHERE id = v_player;
END;
$$;

-- Audit --------------------------------------------------------------------------------------------------------------
CREATE TRIGGER audit_user_roles AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('user_id,role');
CREATE TRIGGER audit_captain_assignments AFTER INSERT OR UPDATE OR DELETE ON public.captain_assignments
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_scorer_assignments AFTER INSERT OR UPDATE OR DELETE ON public.scorer_assignments
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

-- The account directory lists each person's grants (a normal user has none) instead of one role.
DROP FUNCTION public.account_directory(text, uuid[], integer);
CREATE FUNCTION public.account_directory(p_query text DEFAULT NULL, p_ids uuid[] DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS TABLE (user_id uuid, label text, roles text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  WITH words AS (
    SELECT coalesce(array_agg('%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%'), '{}') AS pats
    FROM regexp_split_to_table(btrim(coalesce(p_query, '')), '[[:space:]]+') AS w
    WHERE w <> ''
  ), people AS (
    SELECT u.id,
           NULLIF(btrim(u.email::text), '') AS email,
           COALESCE(NULLIF(regexp_replace(p.real_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
                    NULLIF(regexp_replace(p.nickname, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '')) AS name,
           COALESCE((SELECT array_agg(r.role ORDER BY r.role) FROM public.user_roles r WHERE r.user_id = u.id), '{}') AS roles
    FROM auth.users u
    LEFT JOIN public.user_profiles p ON p.id = u.id
    CROSS JOIN words
    WHERE public.is_dictator()
      AND (p_ids IS NULL OR u.id = ANY (p_ids))
      AND NOT EXISTS (SELECT 1 FROM unnest(words.pats) AS pat
                      WHERE concat_ws(' ', u.email::text, p.real_name, p.nickname) NOT ILIKE pat)
  )
  SELECT id,
         CASE WHEN name IS NOT NULL AND email IS NOT NULL THEN name || ' (' || email || ')'
              ELSE COALESCE(email, name, 'Account without an email') END,
         roles
  FROM people
  ORDER BY 2, 1
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
$$;
REVOKE ALL ON FUNCTION public.account_directory(text, uuid[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_directory(text, uuid[], integer) TO authenticated, service_role;

-- The helper that only managed roles is replaced by is_dictator() and the scoped helpers above.
DROP FUNCTION public.is_role_manager();

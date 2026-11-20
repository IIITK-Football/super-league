-- Canonical match events (D-08): one event history per match, with the score a database-maintained cache.
--
-- * match_events holds goals, own goals and cards. A goal without a known scorer is an unattributed goal (player_id
--   NULL; an own goal may also have an unknown player): it counts toward the score and toward no player's statistics. Removal is voiding (with a reason); rows are
--   never deleted. Edits carry a version so two scorers cannot overwrite each other silently.
-- * matches.home_score / away_score become a cache: an AFTER trigger on match_events recomputes them in the same
--   transaction, and a guard refuses every other write to a played match's score (any role, the server key included).
-- * Walkovers and forfeits are explicit awarded results (result_kind, a required reason and the awarded score) with no
--   goal events; award_match_result is the only writer.
-- * Existing goals (same ids), JSON-only goals and the score surplus are converted, with every finding listed in
--   match_event_migration_report. The migration aborts, changing nothing, on a goal for a team not in the match, more
--   goal rows than the recorded score, a JSON-only scorer with no roster place, or events that exceed the score.
-- * season_player_stats now aggregates events. goals, the match JSON columns and legacy_player_assist_counts are
--   retired by the next migration, after every reader is ported.
-- Forward-only.

-- Columns -----------------------------------------------------------------------------------------------------------
ALTER TABLE public.matches
  ADD COLUMN events_version integer NOT NULL DEFAULT 0,
  ADD COLUMN result_kind text NOT NULL DEFAULT 'played' CONSTRAINT matches_result_kind_check CHECK (result_kind IN ('played', 'walkover', 'forfeit')),
  ADD COLUMN result_reason text,
  ADD CONSTRAINT matches_awarded_needs_reason CHECK (result_kind = 'played' OR (result_reason IS NOT NULL AND btrim(result_reason) <> ''));
ALTER TABLE public.predictions ADD COLUMN graded_events_version integer;
COMMENT ON COLUMN public.matches.events_version IS 'Counts changes to the match''s events. A prediction records the version it was graded at (graded_events_version); a mismatch means the match needs a regrade.';

CREATE TABLE public.match_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE RESTRICT,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  kind text NOT NULL CONSTRAINT match_events_kind_check CHECK (kind IN ('goal', 'own_goal', 'yellow', 'red')),
  player_id uuid REFERENCES public.players(id) ON DELETE RESTRICT,
  assist_player_id uuid REFERENCES public.players(id) ON DELETE RESTRICT,
  minute smallint CONSTRAINT match_events_minute_range CHECK (minute BETWEEN 0 AND 150),
  added_minute smallint CONSTRAINT match_events_added_minute_range CHECK (added_minute BETWEEN 0 AND 30),
  source text NOT NULL DEFAULT 'live' CONSTRAINT match_events_source_check CHECK (source IN ('live', 'migration', 'seed')),
  version integer NOT NULL DEFAULT 1,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason text,
  CONSTRAINT match_events_void_together CHECK ((voided_at IS NULL) = (void_reason IS NULL) AND (void_reason IS NULL OR btrim(void_reason) <> '')),
  CONSTRAINT match_events_assist_on_goal CHECK (assist_player_id IS NULL OR kind = 'goal'),
  CONSTRAINT match_events_assister_not_scorer CHECK (assist_player_id IS NULL OR assist_player_id IS DISTINCT FROM player_id),
  CONSTRAINT match_events_player_needed CHECK (kind IN ('goal', 'own_goal') OR player_id IS NOT NULL)
);
CREATE INDEX match_events_match_idx ON public.match_events (match_id) WHERE voided_at IS NULL;
CREATE INDEX match_events_player_idx ON public.match_events (player_id) WHERE player_id IS NOT NULL;
CREATE INDEX match_events_assist_idx ON public.match_events (assist_player_id) WHERE assist_player_id IS NOT NULL;
COMMENT ON TABLE public.match_events IS 'What happened in a match: goals, own goals and cards. team_id is the team of the player involved (the scorer''s own team for an own goal). A goal with no player is an unattributed goal. Voided rows stay.';

CREATE TABLE public.match_event_migration_report (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id uuid,
  finding text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.match_event_migration_report IS 'Findings of the match event migration (unattributed surplus, walkover candidates, unparsed minutes, assist reconciliation). Dictators read it.';
ALTER TABLE public.match_event_migration_report ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dictators read the match event report" ON public.match_event_migration_report FOR SELECT TO authenticated USING (public.is_dictator());
REVOKE ALL ON public.match_event_migration_report FROM anon, authenticated;
GRANT SELECT ON public.match_event_migration_report TO authenticated;

-- Triggers ---------------------------------------------------------------------------------------------------------
-- Writes validate the event against its match, number its version and refuse edits of voided rows.
CREATE FUNCTION public.match_events_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  m record;
  v_voiding boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.match_id <> OLD.match_id THEN
      RAISE EXCEPTION 'An event cannot move to another match' USING ERRCODE = '23514';
    END IF;
    IF OLD.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'A voided event cannot be edited' USING ERRCODE = '23514';
    END IF;
    v_voiding := NEW.voided_at IS NOT NULL;
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
    IF v_voiding AND NEW.voided_by IS NULL THEN
      NEW.voided_by := auth.uid();
    END IF;
  END IF;

  SELECT home_team_id, away_team_id, season_id, result_kind INTO m FROM public.matches WHERE id = NEW.match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found' USING ERRCODE = 'P0002';
  END IF;
  IF m.result_kind <> 'played' AND NOT v_voiding THEN
    RAISE EXCEPTION 'An awarded result (walkover or forfeit) has no match events' USING ERRCODE = '23514';
  END IF;
  IF NEW.team_id NOT IN (m.home_team_id, m.away_team_id) THEN
    RAISE EXCEPTION 'The team is not playing in this match' USING ERRCODE = '23514';
  END IF;

  -- The people involved hold a roster place for that team in the match's season (migrated history is reported, not refused).
  IF NEW.source <> 'migration' AND NOT v_voiding THEN
    IF NEW.player_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.roster_memberships rm JOIN public.team_entries te ON te.id = rm.team_entry_id
         WHERE rm.player_id = NEW.player_id AND te.team_id = NEW.team_id AND rm.season_id = m.season_id) THEN
      RAISE EXCEPTION 'The player is not on this team''s roster for the match''s season' USING ERRCODE = '23514';
    END IF;
    IF NEW.assist_player_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.roster_memberships rm JOIN public.team_entries te ON te.id = rm.team_entry_id
         WHERE rm.player_id = NEW.assist_player_id AND te.team_id = NEW.team_id AND rm.season_id = m.season_id) THEN
      RAISE EXCEPTION 'The assisting player is not on this team''s roster for the match''s season' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER match_events_before_write BEFORE INSERT OR UPDATE ON public.match_events
  FOR EACH ROW EXECUTE FUNCTION public.match_events_before_write();

CREATE FUNCTION public.match_events_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  RAISE EXCEPTION 'A match event is voided, never deleted' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER match_events_no_delete BEFORE DELETE ON public.match_events FOR EACH ROW EXECUTE FUNCTION public.match_events_no_delete();
CREATE TRIGGER match_events_no_truncate BEFORE TRUNCATE ON public.match_events FOR EACH STATEMENT EXECUTE FUNCTION public.match_events_no_delete();

-- Recomputes a played match's score from its non-voided events and counts the change (events_version). Definer: the
-- caller has no right to the score columns.
CREATE FUNCTION public.recompute_match_score(p_match uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  m record;
  v_home integer;
  v_away integer;
BEGIN
  SELECT id, home_team_id, away_team_id, result_kind INTO m FROM public.matches WHERE id = p_match FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT count(*) FILTER (WHERE (kind = 'goal' AND team_id = m.home_team_id) OR (kind = 'own_goal' AND team_id = m.away_team_id)),
         count(*) FILTER (WHERE (kind = 'goal' AND team_id = m.away_team_id) OR (kind = 'own_goal' AND team_id = m.home_team_id))
  INTO v_home, v_away
  FROM public.match_events WHERE match_id = p_match AND voided_at IS NULL;
  PERFORM set_config('sl.score_writer', 'on', true);
  IF m.result_kind = 'played' THEN
    UPDATE public.matches SET home_score = v_home, away_score = v_away, events_version = events_version + 1 WHERE id = p_match;
  ELSE
    UPDATE public.matches SET events_version = events_version + 1 WHERE id = p_match;
  END IF;
  PERFORM set_config('sl.score_writer', 'off', true);
END;
$$;
REVOKE ALL ON FUNCTION public.recompute_match_score(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.match_events_after_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  PERFORM public.recompute_match_score(NEW.match_id);
  RETURN NULL;
END;
$$;
CREATE TRIGGER match_events_after_write AFTER INSERT OR UPDATE ON public.match_events
  FOR EACH ROW EXECUTE FUNCTION public.match_events_after_write();

-- The score guard: a played match's score, its awarded result and its teams (once events exist) change only through
-- the functions above. A new match starts at 0-0. This holds for every role, the server key included.
CREATE FUNCTION public.matches_guard_score()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF coalesce(current_setting('sl.score_writer', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.result_kind <> 'played' OR coalesce(NEW.home_score, 0) <> 0 OR coalesce(NEW.away_score, 0) <> 0 THEN
      RAISE EXCEPTION 'A new match starts at 0-0; goals add to the score, and a walkover or forfeit is awarded afterwards' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.home_score IS DISTINCT FROM OLD.home_score OR NEW.away_score IS DISTINCT FROM OLD.away_score THEN
      RAISE EXCEPTION 'The score follows the match events; record or correct a goal instead' USING ERRCODE = '23514';
    END IF;
    IF NEW.result_kind IS DISTINCT FROM OLD.result_kind OR NEW.result_reason IS DISTINCT FROM OLD.result_reason
       OR NEW.events_version IS DISTINCT FROM OLD.events_version THEN
      RAISE EXCEPTION 'An awarded result is set only by a dictator through award_match_result' USING ERRCODE = '23514';
    END IF;
    IF (NEW.home_team_id IS DISTINCT FROM OLD.home_team_id OR NEW.away_team_id IS DISTINCT FROM OLD.away_team_id)
       AND EXISTS (SELECT 1 FROM public.match_events e WHERE e.match_id = OLD.id) THEN
      RAISE EXCEPTION 'The teams of a match cannot change once it has events' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER matches_guard_score BEFORE INSERT OR UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.matches_guard_score();

-- Awarded results (walkover, forfeit): a dictator sets the awarded score and a required reason; 'played' clears an award.
CREATE FUNCTION public.award_match_result(p_match uuid, p_kind text, p_home integer, p_away integer, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can award a result' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('played', 'walkover', 'forfeit') THEN
    RAISE EXCEPTION 'Choose played, walkover or forfeit' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.matches WHERE id = p_match FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_kind = 'played' THEN
    PERFORM set_config('sl.score_writer', 'on', true);
    UPDATE public.matches SET result_kind = 'played', result_reason = NULL WHERE id = p_match;
    PERFORM set_config('sl.score_writer', 'off', true);
    PERFORM public.recompute_match_score(p_match);
    RETURN;
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'An awarded result needs a reason' USING ERRCODE = '22023';
  END IF;
  IF p_home IS NULL OR p_away IS NULL OR p_home < 0 OR p_away < 0 THEN
    RAISE EXCEPTION 'The awarded score must be two non-negative numbers' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.match_events WHERE match_id = p_match AND voided_at IS NULL AND kind IN ('goal', 'own_goal')) THEN
    RAISE EXCEPTION 'This match has goal events; void them before awarding a result' USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('sl.score_writer', 'on', true);
  UPDATE public.matches
  SET result_kind = p_kind, result_reason = btrim(p_reason), home_score = p_home, away_score = p_away,
      status = 'completed', events_version = events_version + 1
  WHERE id = p_match;
  PERFORM set_config('sl.score_writer', 'off', true);
END;
$$;
REVOKE ALL ON FUNCTION public.award_match_result(uuid, text, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.award_match_result(uuid, text, integer, integer, text) TO authenticated, service_role;

-- Access --------------------------------------------------------------------------------------------------------------
ALTER TABLE public.match_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.match_events FROM anon, authenticated;
GRANT SELECT ON public.match_events TO anon, authenticated;
GRANT INSERT, UPDATE ON public.match_events TO authenticated;
CREATE POLICY "Public read match events" ON public.match_events FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Scorers record match events" ON public.match_events FOR INSERT TO authenticated WITH CHECK (public.can_score(match_id));
CREATE POLICY "Scorers correct match events" ON public.match_events FOR UPDATE TO authenticated
  USING (public.can_score(match_id)) WITH CHECK (public.can_score(match_id));

-- Clients never write the score columns: column-level UPDATE on every other match column only.
DO $$
DECLARE
  cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ') INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'matches'
    AND column_name NOT IN ('home_score', 'away_score', 'events_version', 'result_kind', 'result_reason');
  EXECUTE 'REVOKE UPDATE ON public.matches FROM authenticated, anon';
  EXECUTE format('GRANT UPDATE (%s) ON public.matches TO authenticated', cols);
END;
$$;

-- Audit: events are recorded; the score change stays recorded, only the running counter is noise.
CREATE TRIGGER audit_match_events AFTER INSERT OR UPDATE OR DELETE ON public.match_events
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
DROP TRIGGER audit_matches ON public.matches;
CREATE TRIGGER audit_matches AFTER INSERT OR UPDATE OR DELETE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('id', '', 'minute,timer_start_time,timer_calibration,events_version');

-- Backfill -----------------------------------------------------------------------------------------------------------
-- One transaction: the blockers below stop everything; the guards after the conversion compare ids and scores.
-- migration-guard:start
CREATE FUNCTION pg_temp.parse_minute(t text) RETURNS smallint LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN t ~ '^\s*\d{1,3}' AND substring(t from '^\s*(\d{1,3})')::int BETWEEN 0 AND 150 THEN substring(t from '^\s*(\d{1,3})')::smallint END
$f$;
CREATE FUNCTION pg_temp.parse_added(t text) RETURNS smallint LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN t ~ '^\s*\d{1,3}\s*\+\s*\d{1,2}' AND substring(t from '\+\s*(\d{1,2})')::int BETWEEN 0 AND 30 THEN substring(t from '\+\s*(\d{1,2})')::smallint END
$f$;

CREATE TEMP TABLE _score_before ON COMMIT DROP AS SELECT id, home_score, away_score FROM public.matches;
CREATE TEMP TABLE _goal_ids ON COMMIT DROP AS SELECT id FROM public.goals;

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM public.goals g LEFT JOIN public.matches m ON m.id = g.match_id
  WHERE g.match_id IS NULL OR g.team_id IS NULL OR g.team_id NOT IN (m.home_team_id, m.away_team_id);
  IF n > 0 THEN
    RAISE EXCEPTION '% goal row(s) belong to no match or to a team that is not playing in it; nothing was changed', n;
  END IF;
  SELECT count(*) INTO n FROM (
    SELECT m.id FROM public.matches m
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE (NOT g.is_own_goal AND g.team_id = m.home_team_id) OR (g.is_own_goal AND g.team_id = m.away_team_id)) AS h,
             count(*) FILTER (WHERE (NOT g.is_own_goal AND g.team_id = m.away_team_id) OR (g.is_own_goal AND g.team_id = m.home_team_id)) AS a
      FROM public.goals g WHERE g.match_id = m.id) r ON true
    WHERE r.h > COALESCE(m.home_score, 0) OR r.a > COALESCE(m.away_score, 0)
  ) x;
  IF n > 0 THEN
    RAISE EXCEPTION '% match(es) have more goal rows than the recorded score; nothing was changed', n;
  END IF;
END;
$$;

-- Goal rows keep their ids.
INSERT INTO public.match_events (id, match_id, team_id, kind, player_id, assist_player_id, minute, added_minute, source, created_at)
SELECT g.id, g.match_id, g.team_id, CASE WHEN g.is_own_goal THEN 'own_goal' ELSE 'goal' END,
       g.player_id, CASE WHEN g.is_own_goal OR g.assist_id IS NOT DISTINCT FROM g.player_id THEN NULL ELSE g.assist_id END, pg_temp.parse_minute(g.minute), pg_temp.parse_added(g.minute),
       'migration', COALESCE(g.scored_at, now())
FROM public.goals g;
INSERT INTO public.match_event_migration_report (match_id, finding, detail)
SELECT g.match_id, 'assist_dropped', jsonb_build_object('goal_id', g.id, 'reason', CASE WHEN g.is_own_goal THEN 'own goal' ELSE 'assister is the scorer' END)
FROM public.goals g WHERE g.assist_id IS NOT NULL AND (g.is_own_goal OR g.assist_id IS NOT DISTINCT FROM g.player_id);

INSERT INTO public.match_event_migration_report (match_id, finding, detail)
SELECT g.match_id, 'unparsed_minute', jsonb_build_object('goal_id', g.id, 'minute', g.minute)
FROM public.goals g WHERE g.minute IS NOT NULL AND btrim(g.minute) <> '' AND pg_temp.parse_minute(g.minute) IS NULL;

-- JSON-only goals, own goals and assists (elements are player-id strings or {"player_id": ...} objects).
CREATE TEMP TABLE _json ON COMMIT DROP AS
SELECT m.id AS match_id, m.season_id, m.home_team_id, m.away_team_id, x.kind, p.id AS player_id
FROM public.matches m
CROSS JOIN LATERAL (
  SELECT CASE jsonb_typeof(el) WHEN 'string' THEN el #>> '{}' WHEN 'object' THEN el ->> 'player_id' END AS ref, 'goal' AS kind
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.scorers) = 'array' THEN m.scorers ELSE '[]'::jsonb END) el
  UNION ALL
  SELECT CASE jsonb_typeof(el) WHEN 'string' THEN el #>> '{}' WHEN 'object' THEN el ->> 'player_id' END, 'own_goal'
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.own_goals) = 'array' THEN m.own_goals ELSE '[]'::jsonb END) el
  UNION ALL
  SELECT CASE jsonb_typeof(el) WHEN 'string' THEN el #>> '{}' WHEN 'object' THEN el ->> 'player_id' END, 'assist'
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.assists) = 'array' THEN m.assists ELSE '[]'::jsonb END) el
) x
JOIN public.players p ON p.id::text = x.ref;

CREATE TEMP TABLE _json_extra ON COMMIT DROP AS
WITH jc AS (SELECT match_id, season_id, home_team_id, away_team_id, player_id, kind, count(*) AS n FROM _json GROUP BY 1, 2, 3, 4, 5, 6),
     rc AS (
       SELECT match_id, player_id, CASE WHEN kind = 'own_goal' THEN 'own_goal' ELSE 'goal' END AS kind, count(*) AS n
       FROM public.match_events WHERE player_id IS NOT NULL AND kind IN ('goal', 'own_goal') GROUP BY 1, 2, 3
       UNION ALL
       SELECT match_id, assist_player_id, 'assist', count(*) FROM public.match_events WHERE assist_player_id IS NOT NULL GROUP BY 1, 2
     )
SELECT jc.match_id, jc.season_id, jc.home_team_id, jc.away_team_id, jc.player_id, jc.kind, jc.n - COALESCE(rc.n, 0) AS extra
FROM jc LEFT JOIN rc ON rc.match_id = jc.match_id AND rc.player_id = jc.player_id AND rc.kind = jc.kind
WHERE jc.n - COALESCE(rc.n, 0) > 0;

CREATE TEMP TABLE _json_team ON COMMIT DROP AS
SELECT e.*, (SELECT te.team_id FROM public.roster_memberships rm JOIN public.team_entries te ON te.id = rm.team_entry_id
             WHERE rm.player_id = e.player_id AND rm.season_id = e.season_id
               AND te.team_id IN (e.home_team_id, e.away_team_id) LIMIT 1) AS team_id
FROM _json_extra e;

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM _json_team WHERE team_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '% match-JSON scorer(s) or assister(s) have no roster place on a team in their match; nothing was changed', n;
  END IF;
END;
$$;

INSERT INTO public.match_events (match_id, team_id, kind, player_id, source)
SELECT t.match_id, t.team_id, t.kind, t.player_id, 'migration'
FROM _json_team t CROSS JOIN LATERAL generate_series(1, t.extra::int) WHERE t.kind IN ('goal', 'own_goal');

-- JSON-only assists attach to goals of the same team in that match that have no assister; the rest are reported.
WITH want AS (
  SELECT t.match_id, t.team_id, t.player_id, generate_series(1, t.extra::int) AS k FROM _json_team t WHERE t.kind = 'assist'
), slots AS (
  SELECT e.id, e.match_id, e.team_id, row_number() OVER (PARTITION BY e.match_id, e.team_id ORDER BY e.created_at, e.id) AS rn
  FROM public.match_events e WHERE e.kind = 'goal' AND e.voided_at IS NULL AND e.assist_player_id IS NULL
), wanted AS (
  SELECT w.*, row_number() OVER (PARTITION BY w.match_id, w.team_id ORDER BY w.player_id, w.k) AS rn FROM want w
)
UPDATE public.match_events e SET assist_player_id = w.player_id
FROM wanted w JOIN slots s ON s.match_id = w.match_id AND s.team_id = w.team_id AND s.rn = w.rn
WHERE e.id = s.id AND w.player_id IS DISTINCT FROM e.player_id;

-- Score surplus becomes clearly tagged unattributed goals; events that exceed the score are a blocker.
CREATE TEMP TABLE _surplus ON COMMIT DROP AS
SELECT m.id AS match_id, m.home_team_id, m.away_team_id,
       COALESCE(m.home_score, 0) - COALESCE(c.h, 0) AS home_extra, COALESCE(m.away_score, 0) - COALESCE(c.a, 0) AS away_extra
FROM public.matches m
LEFT JOIN LATERAL (
  SELECT count(*) FILTER (WHERE (e.kind = 'goal' AND e.team_id = m.home_team_id) OR (e.kind = 'own_goal' AND e.team_id = m.away_team_id)) AS h,
         count(*) FILTER (WHERE (e.kind = 'goal' AND e.team_id = m.away_team_id) OR (e.kind = 'own_goal' AND e.team_id = m.home_team_id)) AS a
  FROM public.match_events e WHERE e.match_id = m.id AND e.voided_at IS NULL) c ON true;
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM _surplus WHERE home_extra < 0 OR away_extra < 0;
  IF n > 0 THEN
    RAISE EXCEPTION '% match(es) have more goal events than the recorded score after the conversion; nothing was changed', n;
  END IF;
END;
$$;
INSERT INTO public.match_events (match_id, team_id, kind, source)
SELECT s.match_id, s.home_team_id, 'goal', 'migration' FROM _surplus s CROSS JOIN LATERAL generate_series(1, s.home_extra) WHERE s.home_extra > 0
UNION ALL
SELECT s.match_id, s.away_team_id, 'goal', 'migration' FROM _surplus s CROSS JOIN LATERAL generate_series(1, s.away_extra) WHERE s.away_extra > 0;

INSERT INTO public.match_event_migration_report (match_id, finding, detail)
SELECT match_id, 'unattributed_surplus', jsonb_build_object('home', GREATEST(home_extra, 0), 'away', GREATEST(away_extra, 0))
FROM _surplus WHERE home_extra > 0 OR away_extra > 0;
INSERT INTO public.match_event_migration_report (match_id, finding, detail)
SELECT m.id, 'walkover_candidate', jsonb_build_object('home', m.home_score, 'away', m.away_score)
FROM public.matches m
WHERE m.status = 'completed' AND (COALESCE(m.home_score, 0) + COALESCE(m.away_score, 0)) > 0
  AND NOT EXISTS (SELECT 1 FROM public.goals g WHERE g.match_id = m.id)
  AND NOT EXISTS (SELECT 1 FROM _json j WHERE j.match_id = m.id);
INSERT INTO public.match_event_migration_report (finding, detail)
SELECT 'assist_snapshot', jsonb_build_object('player_id', s.player_id, 'counter_value', s.counter_value, 'assists_at_capture', s.event_assists_at_capture,
         'assists_in_events', (SELECT count(*) FROM public.match_events e WHERE e.assist_player_id = s.player_id AND e.voided_at IS NULL))
FROM public.legacy_player_assist_counts s;

-- Guards: every goal id has its event, and every score is unchanged (the trigger recomputed it from the events).
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM _goal_ids g WHERE NOT EXISTS (SELECT 1 FROM public.match_events e WHERE e.id = g.id);
  IF n > 0 THEN
    RAISE EXCEPTION '% goal row(s) have no match event; nothing was changed', n;
  END IF;
  SELECT count(*) INTO n FROM _score_before b JOIN public.matches m ON m.id = b.id
  WHERE m.home_score IS DISTINCT FROM b.home_score OR m.away_score IS DISTINCT FROM b.away_score;
  IF n > 0 THEN
    RAISE EXCEPTION '% match score(s) differ from the events after the conversion; nothing was changed', n;
  END IF;
  RAISE NOTICE 'match events created: %; report rows: %', (SELECT count(*) FROM public.match_events), (SELECT count(*) FROM public.match_event_migration_report);
END;
$$;
-- migration-guard:end

-- Predictions graded before this migration were graded from the same goals now held as events: they are current.
UPDATE public.predictions p SET graded_events_version = m.events_version FROM public.matches m WHERE m.id = p.match_id AND p.status = 'graded';

-- Matches whose events changed after their predictions were graded (dictators read predictions through row level security).
CREATE FUNCTION public.matches_needing_regrade(p_season uuid DEFAULT NULL)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  SELECT DISTINCT m.id FROM public.matches m JOIN public.predictions p ON p.match_id = m.id
  WHERE m.is_graded AND p.status = 'graded' AND p.graded_events_version IS DISTINCT FROM m.events_version
    AND (p_season IS NULL OR m.season_id = p_season)
$$;
REVOKE ALL ON FUNCTION public.matches_needing_regrade(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.matches_needing_regrade(uuid) TO authenticated, service_role;

-- Statistics ---------------------------------------------------------------------------------------------------------
-- Per (season, player) from non-voided events of played matches. Unattributed goals appear in no line; goals exclude own goals.
CREATE OR REPLACE VIEW public.season_player_stats WITH (security_invoker = true) AS
WITH lines AS (
  SELECT m.season_id, e.player_id,
         count(*) FILTER (WHERE e.kind = 'goal')::integer AS goals,
         count(*) FILTER (WHERE e.kind = 'own_goal')::integer AS own_goals,
         count(*) FILTER (WHERE e.kind = 'yellow')::integer AS yellow_cards,
         count(*) FILTER (WHERE e.kind = 'red')::integer AS red_cards,
         (array_agg(e.team_id ORDER BY e.team_id))[1] AS event_team_id
  FROM public.match_events e JOIN public.matches m ON m.id = e.match_id
  WHERE e.voided_at IS NULL AND e.player_id IS NOT NULL AND m.season_id IS NOT NULL
  GROUP BY m.season_id, e.player_id
), assists AS (
  SELECT m.season_id, e.assist_player_id AS player_id, count(*)::integer AS assists, (array_agg(e.team_id ORDER BY e.team_id))[1] AS event_team_id
  FROM public.match_events e JOIN public.matches m ON m.id = e.match_id
  WHERE e.voided_at IS NULL AND e.assist_player_id IS NOT NULL AND e.kind = 'goal' AND m.season_id IS NOT NULL
  GROUP BY m.season_id, e.assist_player_id
), combined AS (
  SELECT COALESCE(l.season_id, a.season_id) AS season_id, COALESCE(l.player_id, a.player_id) AS player_id,
         COALESCE(l.goals, 0) AS goals, COALESCE(a.assists, 0) AS assists, COALESCE(l.own_goals, 0) AS own_goals,
         COALESCE(l.yellow_cards, 0) AS yellow_cards, COALESCE(l.red_cards, 0) AS red_cards,
         COALESCE(l.event_team_id, a.event_team_id) AS event_team_id
  FROM lines l FULL JOIN assists a ON a.season_id = l.season_id AND a.player_id = l.player_id
)
SELECT c.season_id,
       p.id AS player_id,
       (p.first_name::text || ' ' || p.last_name::text) AS name,
       COALESCE(rt.name, et.name)::text AS club,
       c.goals,
       c.assists,
       c.own_goals,
       c.yellow_cards,
       c.red_cards
FROM combined c
JOIN public.players p ON p.id = c.player_id
LEFT JOIN public.roster_memberships rm ON rm.player_id = c.player_id AND rm.season_id = c.season_id
LEFT JOIN public.team_entries te ON te.id = rm.team_entry_id
LEFT JOIN public.teams rt ON rt.id = te.team_id
LEFT JOIN public.teams et ON et.id = c.event_team_id;
COMMENT ON VIEW public.season_player_stats IS 'Goals, assists, own goals and cards per player and season, aggregated from non-voided match events. Unattributed goals count toward no line. Appearances wait for lineups.';
GRANT SELECT ON public.season_player_stats TO anon, authenticated, service_role;

-- A roster place is history once the player appears in any event of that season (voided or not): it cannot be removed,
-- or moved to another player or season. Moving to another team in the same season stays allowed.
CREATE OR REPLACE FUNCTION public.roster_memberships_keep_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.player_id = OLD.player_id AND NEW.season_id = OLD.season_id THEN
    RETURN NEW;
  END IF;
  IF public.player_has_match_history(OLD.player_id, OLD.season_id) THEN
    RAISE EXCEPTION 'This player has goals or assists this season, so their place on the roster is kept'
      USING ERRCODE = '23503';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.player_has_match_history(p_player_id uuid, p_season_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.match_events e JOIN public.matches m ON m.id = e.match_id
    WHERE (e.player_id = p_player_id OR e.assist_player_id = p_player_id)
      AND (p_season_id IS NULL OR m.season_id = p_season_id)
  );
$$;

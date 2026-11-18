-- Divisions, seasons and configurable sections (expand step).
--
-- Divisions and seasons become ordinary data records: a dictator creates and configures any division and any
-- number of seasons with no code, enum, check-constraint or migration change. Nothing in this migration lists
-- division values except the one-time legacy mapping inside public.backfill_legacy_divisions(), which follows
-- docs/decisions/D-01-division-season-mapping.md.
--
-- Expand only (docs/decisions/SL-004-migration-and-cutover-strategy.md §3): the legacy `division` columns, their
-- check constraints, the views and every existing reader stay unchanged. While legacy writers still exist:
--   * matches / team_registrations: `season_id` is authoritative once set; the other side is derived by trigger;
--   * teams: a team whose legacy division is mapped gets a team entry in that division's current season
--     (insert-only, never updated or deleted by a trigger);
--   * public.division_model_drift() lists every disagreement and anomaly and must stay empty apart from
--     reported anomalies (an `inter` value or a missing division), which are never guessed.
-- Forward-only: fix defects with a new migration.

-- Tables ---------------------------------------------------------------------------------------------------

CREATE TABLE public.divisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CONSTRAINT divisions_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 60),
  name text NOT NULL CONSTRAINT divisions_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  short_name text CONSTRAINT divisions_short_name_length CHECK (short_name IS NULL OR char_length(short_name) BETWEEN 1 AND 20),
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  visibility text NOT NULL DEFAULT 'public' CONSTRAINT divisions_visibility_check CHECK (visibility IN ('public', 'hidden')),
  archived_at timestamptz,
  logo_url text,
  primary_color text CONSTRAINT divisions_primary_color_hex CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text CONSTRAINT divisions_secondary_color_hex CHECK (secondary_color IS NULL OR secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL
);
COMMENT ON TABLE public.divisions IS 'A long-lived competition identity (data, never an enum). Hidden/archived is separate from deletion.';

CREATE TABLE public.seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id uuid NOT NULL REFERENCES public.divisions(id) ON DELETE RESTRICT,
  slug text NOT NULL CONSTRAINT seasons_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 60),
  name text NOT NULL CONSTRAINT seasons_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  starts_on date,
  ends_on date,
  status text NOT NULL DEFAULT 'planned' CONSTRAINT seasons_status_check CHECK (status IN ('planned', 'registration', 'active', 'completed')),
  visibility text NOT NULL DEFAULT 'public' CONSTRAINT seasons_visibility_check CHECK (visibility IN ('public', 'hidden')),
  archived_at timestamptz,
  is_current boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  format text NOT NULL DEFAULT 'league' CONSTRAINT seasons_format_check CHECK (format IN ('league', 'knockout', 'league_knockout')),
  rules_md text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT seasons_dates_order CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT seasons_division_slug_key UNIQUE (division_id, slug)
);
CREATE UNIQUE INDEX seasons_one_current_per_division ON public.seasons (division_id) WHERE is_current;
COMMENT ON TABLE public.seasons IS 'One run of a division. Several seasons of one division can coexist; at most one is current.';

CREATE TABLE public.section_types (
  key text PRIMARY KEY CONSTRAINT section_types_key_format CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  label text NOT NULL,
  description text,
  default_enabled boolean NOT NULL DEFAULT true,
  default_sort_order integer NOT NULL DEFAULT 0
);
COMMENT ON TABLE public.section_types IS 'Catalogue of section kinds a season can enable (lookup data, not an enum).';

INSERT INTO public.section_types (key, label, description, default_enabled, default_sort_order) VALUES
  ('overview',     'Overview',     'Season landing content',                          true,  10),
  ('fixtures',     'Fixtures',     'Schedule and results',                            true,  20),
  ('standings',    'Standings',    'League table',                                    true,  30),
  ('bracket',      'Bracket',      'Knockout bracket',                                false, 40),
  ('teams',        'Teams',        'Teams and rosters',                               true,  50),
  ('team_builder', 'Team builder', 'Captain team builder',                            false, 60),
  ('stats',        'Statistics',   'Top scorers and assists',                         true,  70),
  ('fantasy',      'Fantasy',      'Predictions and leaderboard for this season',     true,  80),
  ('news',         'News',         'Editorial placement for this season',             true,  90),
  ('video',        'Video',        'Season video chapter on the home page',           false, 100),
  ('rules',        'Rules',        'Season rules',                                    true,  110),
  ('registration', 'Registration', 'Team and player registration settings',           false, 120);

CREATE TABLE public.season_sections (
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  section_key text NOT NULL REFERENCES public.section_types(key) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT true,
  nav_visible boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT season_sections_settings_object CHECK (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, section_key)
);
COMMENT ON TABLE public.season_sections IS 'Per-season section configuration (enabled, navigation, order, settings such as news placement or video chapter).';

CREATE TABLE public.team_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE matches the legacy behaviour of deleting a team; a team that has matches cannot be deleted at all
  -- (matches_home/away_team_id_fkey have no ON DELETE action), so no participation with match history is lost.
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_entries_team_season_key UNIQUE (team_id, season_id)
);
CREATE INDEX team_entries_season_id_idx ON public.team_entries (season_id);
COMMENT ON TABLE public.team_entries IS 'A team''s participation in one season.';

CREATE TABLE public.legacy_division_map (
  legacy_key text PRIMARY KEY,
  division_id uuid NOT NULL UNIQUE REFERENCES public.divisions(id) ON DELETE RESTRICT,
  initial_season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.legacy_division_map IS 'Expand-period only: legacy division string -> division. Removed with the legacy columns.';

ALTER TABLE public.matches ADD COLUMN season_id uuid REFERENCES public.seasons(id) ON DELETE RESTRICT;
CREATE INDEX matches_season_id_idx ON public.matches (season_id);
ALTER TABLE public.team_registrations ADD COLUMN season_id uuid REFERENCES public.seasons(id) ON DELETE RESTRICT;
CREATE INDEX team_registrations_season_id_idx ON public.team_registrations (season_id);
-- A registration in a division without a legacy value carries no legacy string.
ALTER TABLE public.team_registrations ALTER COLUMN division DROP NOT NULL;

CREATE TRIGGER divisions_updated_at BEFORE UPDATE ON public.divisions FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER seasons_updated_at BEFORE UPDATE ON public.seasons FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER season_sections_updated_at BEFORE UPDATE ON public.season_sections FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Functions ------------------------------------------------------------------------------------------------

-- D-01 season name: "2026" (one calendar year), "2025–26" (two consecutive years), "2024–2026" (longer).
-- With no match dates, the fallback date's year is used.
CREATE FUNCTION public.season_label(p_first date, p_last date, p_fallback date)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO ''
AS $$
  SELECT CASE
    WHEN p_first IS NULL OR p_last IS NULL THEN extract(year FROM p_fallback)::int::text
    WHEN extract(year FROM p_first) = extract(year FROM p_last) THEN extract(year FROM p_first)::int::text
    WHEN extract(year FROM p_last) = extract(year FROM p_first) + 1
      THEN extract(year FROM p_first)::int::text || '–' || lpad((extract(year FROM p_last)::int % 100)::text, 2, '0')
    ELSE extract(year FROM p_first)::int::text || '–' || extract(year FROM p_last)::int::text
  END
$$;

-- The current season of the division a legacy value maps to (NULL when unmapped or no season is current).
CREATE FUNCTION public.legacy_current_season(p_legacy text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $$
  SELECT s.id
  FROM public.legacy_division_map m
  JOIN public.seasons s ON s.division_id = m.division_id AND s.is_current
  WHERE m.legacy_key = p_legacy
$$;

-- The legacy value of a season's division (NULL when the division has none).
CREATE FUNCTION public.legacy_key_for_season(p_season uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $$
  SELECT m.legacy_key
  FROM public.seasons s
  JOIN public.legacy_division_map m ON m.division_id = s.division_id
  WHERE s.id = p_season
$$;

-- Dictator only. No other role implies it, and the legacy "admin" label grants nothing.
CREATE FUNCTION public.is_dictator()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'dictator')
$$;

-- Keeps the legacy string and season_id consistent on matches and team_registrations.
CREATE FUNCTION public.sync_legacy_division_season()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.season_id IS NOT NULL THEN
      NEW.division := public.legacy_key_for_season(NEW.season_id);
    ELSIF NEW.division IS NOT NULL THEN
      NEW.season_id := public.legacy_current_season(NEW.division);
    END IF;
  ELSIF NEW.season_id IS DISTINCT FROM OLD.season_id AND NEW.season_id IS NOT NULL THEN
    NEW.division := public.legacy_key_for_season(NEW.season_id);
  ELSIF NEW.division IS DISTINCT FROM OLD.division THEN
    NEW.season_id := CASE WHEN NEW.division IS NULL THEN NULL ELSE public.legacy_current_season(NEW.division) END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER matches_sync_division_season
  BEFORE INSERT OR UPDATE OF division, season_id ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.sync_legacy_division_season();
CREATE TRIGGER team_registrations_sync_division_season
  BEFORE INSERT OR UPDATE OF division, season_id ON public.team_registrations
  FOR EACH ROW EXECUTE FUNCTION public.sync_legacy_division_season();

-- Insert-only: a team written by a legacy writer joins its mapped division's current season.
CREATE FUNCTION public.enter_team_in_legacy_season()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $$
DECLARE
  v_season uuid;
BEGIN
  IF NEW.division IS NOT NULL THEN
    v_season := public.legacy_current_season(NEW.division);
    IF v_season IS NOT NULL THEN
      INSERT INTO public.team_entries (team_id, season_id) VALUES (NEW.id, v_season)
      ON CONFLICT (team_id, season_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER teams_enter_legacy_season
  AFTER INSERT OR UPDATE OF division ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.enter_team_in_legacy_season();

-- Idempotent backfill (D-01). Creates a division, one initial season, its default sections and the map row for
-- each populated legacy value that is not mapped yet, then attaches unmapped legacy rows. Re-running it changes
-- nothing once everything is mapped. Called by this migration (hosted data) and by seed.sql (synthetic data).
CREATE FUNCTION public.backfill_legacy_divisions()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $$
DECLARE
  v_def record;
  v_division uuid;
  v_season uuid;
  v_first date;
  v_last date;
  v_fallback date;
  v_label text;
  v_created integer := 0;
  v_matches integer := 0;
  v_regs integer := 0;
  v_entries integer := 0;
  v_n integer;
BEGIN
  FOR v_def IN
    SELECT * FROM (VALUES
      ('mens',     'super-league', 'Super League', 'SL',       1),
      ('womens',   'wsl',          'WSL',          'WSL',      2),
      ('freshers', 'freshers',     'Freshers',     'Freshers', 3)
    ) AS d(legacy_key, slug, name, short_name, sort_order)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.legacy_division_map WHERE legacy_key = v_def.legacy_key) THEN
      IF NOT (EXISTS (SELECT 1 FROM public.teams WHERE division = v_def.legacy_key)
           OR EXISTS (SELECT 1 FROM public.matches WHERE division = v_def.legacy_key)
           OR EXISTS (SELECT 1 FROM public.team_registrations WHERE division = v_def.legacy_key)) THEN
        CONTINUE; -- not populated: no division is created
      END IF;

      SELECT min((date AT TIME ZONE 'Asia/Kolkata')::date), max((date AT TIME ZONE 'Asia/Kolkata')::date)
        INTO v_first, v_last
      FROM public.matches WHERE division = v_def.legacy_key AND date IS NOT NULL;
      SELECT COALESCE(min((created_at AT TIME ZONE 'Asia/Kolkata')::date), (now() AT TIME ZONE 'Asia/Kolkata')::date)
        INTO v_fallback
      FROM public.team_registrations WHERE division = v_def.legacy_key;
      v_label := public.season_label(v_first, v_last, v_fallback);

      INSERT INTO public.divisions (slug, name, short_name, sort_order, created_by)
      VALUES (v_def.slug, v_def.name, v_def.short_name, v_def.sort_order, NULL)
      RETURNING id INTO v_division;

      INSERT INTO public.seasons (division_id, slug, name, starts_on, ends_on, status, is_current, created_by)
      VALUES (v_division, replace(v_label, '–', '-'), v_label, v_first, v_last, 'active', true, NULL)
      RETURNING id INTO v_season;

      INSERT INTO public.season_sections (season_id, section_key, enabled, nav_visible, sort_order)
      SELECT v_season, key, default_enabled, default_enabled, default_sort_order FROM public.section_types;

      INSERT INTO public.legacy_division_map (legacy_key, division_id, initial_season_id)
      VALUES (v_def.legacy_key, v_division, v_season);
      v_created := v_created + 1;
    END IF;

    v_season := public.legacy_current_season(v_def.legacy_key);
    CONTINUE WHEN v_season IS NULL;

    UPDATE public.matches SET season_id = v_season WHERE division = v_def.legacy_key AND season_id IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_matches := v_matches + v_n;
    UPDATE public.team_registrations SET season_id = v_season WHERE division = v_def.legacy_key AND season_id IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_regs := v_regs + v_n;
    INSERT INTO public.team_entries (team_id, season_id)
    SELECT t.id, v_season FROM public.teams t
    WHERE t.division = v_def.legacy_key
      AND NOT EXISTS (SELECT 1 FROM public.team_entries e JOIN public.seasons s ON s.id = e.season_id
                      JOIN public.legacy_division_map m ON m.division_id = s.division_id
                      WHERE e.team_id = t.id AND m.legacy_key = v_def.legacy_key)
    ON CONFLICT (team_id, season_id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_entries := v_entries + v_n;
  END LOOP;

  RETURN jsonb_build_object('divisions_created', v_created, 'matches_attached', v_matches,
                            'registrations_attached', v_regs, 'team_entries_created', v_entries);
END;
$$;

-- Every disagreement between the legacy strings and the new model. Kinds:
--   unmapped_value  a legacy value with no division (e.g. inter)         anomaly, reported only
--   no_division     a legacy row with neither division nor season          anomaly, reported only
--   mismatch        division and season_id disagree                        drift
--   no_season       a mapped value with no season attached                 drift
--   team_no_entry   a team of a mapped division with no entry in it        drift
--   team_division   a registration whose division differs from its team's  drift
CREATE FUNCTION public.division_model_drift()
RETURNS TABLE (entity text, row_id uuid, kind text, detail text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $$
  WITH legacy_rows AS (
    SELECT 'match'::text AS entity, id, division::text AS division, season_id FROM public.matches
    UNION ALL
    SELECT 'registration', id, division, season_id FROM public.team_registrations
  )
  SELECT r.entity, r.id,
         CASE
           WHEN r.division IS NULL AND r.season_id IS NULL THEN 'no_division'
           WHEN r.division IS NOT NULL AND m.legacy_key IS NULL THEN 'unmapped_value'
           WHEN r.season_id IS NULL THEN 'no_season'
           ELSE 'mismatch'
         END,
         COALESCE(r.division, '(null)')
  FROM legacy_rows r
  LEFT JOIN public.legacy_division_map m ON m.legacy_key = r.division
  LEFT JOIN public.seasons s ON s.id = r.season_id
  LEFT JOIN public.legacy_division_map sm ON sm.division_id = s.division_id
  WHERE (r.division IS NULL AND r.season_id IS NULL)
     OR (r.division IS NOT NULL AND m.legacy_key IS NULL)
     OR (r.division IS NOT NULL AND r.season_id IS NULL)
     OR (r.season_id IS NOT NULL AND r.division IS DISTINCT FROM sm.legacy_key)
  UNION ALL
  SELECT 'team', t.id, 'team_no_entry', t.division::text
  FROM public.teams t
  JOIN public.legacy_division_map m ON m.legacy_key = t.division
  WHERE NOT EXISTS (SELECT 1 FROM public.team_entries e JOIN public.seasons s ON s.id = e.season_id
                    WHERE e.team_id = t.id AND s.division_id = m.division_id)
  UNION ALL
  SELECT 'registration', r.id, 'team_division', r.division || ' vs ' || t.division
  FROM public.team_registrations r
  JOIN public.teams t ON t.id = r.team_id
  WHERE r.division IS DISTINCT FROM t.division::text
$$;

-- Privileges -----------------------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.legacy_current_season(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.legacy_key_for_season(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_legacy_division_season() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enter_team_in_legacy_season() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.backfill_legacy_divisions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.division_model_drift() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_dictator() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_dictator() TO authenticated;
GRANT EXECUTE ON FUNCTION public.legacy_current_season(text), public.legacy_key_for_season(uuid),
  public.backfill_legacy_divisions(), public.division_model_drift(), public.is_dictator() TO service_role;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.divisions, public.seasons, public.section_types,
  public.season_sections, public.team_entries, public.legacy_division_map FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.legacy_division_map FROM authenticated;

-- Row-level security ---------------------------------------------------------------------------------------

ALTER TABLE public.divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.section_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.season_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_division_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read visible divisions" ON public.divisions FOR SELECT TO anon, authenticated
  USING (visibility = 'public' AND archived_at IS NULL);
CREATE POLICY "Dictators manage divisions" ON public.divisions TO authenticated
  USING (public.is_dictator()) WITH CHECK (public.is_dictator());

-- The division subquery is itself filtered by the divisions policies.
CREATE POLICY "Public read visible seasons" ON public.seasons FOR SELECT TO anon, authenticated
  USING (visibility = 'public' AND archived_at IS NULL
         AND EXISTS (SELECT 1 FROM public.divisions d WHERE d.id = division_id AND d.visibility = 'public' AND d.archived_at IS NULL));
CREATE POLICY "Dictators manage seasons" ON public.seasons TO authenticated
  USING (public.is_dictator()) WITH CHECK (public.is_dictator());

CREATE POLICY "Public read section types" ON public.section_types FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Dictators manage section types" ON public.section_types TO authenticated
  USING (public.is_dictator()) WITH CHECK (public.is_dictator());

CREATE POLICY "Public read sections of visible seasons" ON public.season_sections FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = season_id));
CREATE POLICY "Dictators manage season sections" ON public.season_sections TO authenticated
  USING (public.is_dictator()) WITH CHECK (public.is_dictator());

CREATE POLICY "Public read entries of visible seasons" ON public.team_entries FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = season_id));
CREATE POLICY "Dictators manage team entries" ON public.team_entries TO authenticated
  USING (public.is_dictator()) WITH CHECK (public.is_dictator());

CREATE POLICY "Public read legacy division map" ON public.legacy_division_map FOR SELECT TO anon, authenticated USING (true);

-- Backfill existing data -----------------------------------------------------------------------------------

DO $$
DECLARE
  v_result jsonb;
  v_drift integer;
  v_anomalies integer;
BEGIN
  v_result := public.backfill_legacy_divisions();
  SELECT count(*) FILTER (WHERE kind NOT IN ('unmapped_value', 'no_division')),
         count(*) FILTER (WHERE kind IN ('unmapped_value', 'no_division'))
    INTO v_drift, v_anomalies
  FROM public.division_model_drift();
  IF v_drift > 0 THEN
    RAISE EXCEPTION 'Division backfill left % inconsistent row(s); nothing was changed. Inspect with SELECT * FROM public.division_model_drift().', v_drift;
  END IF;
  RAISE NOTICE 'division backfill: % (anomalies reported, not mapped: %)', v_result, v_anomalies;
END $$;

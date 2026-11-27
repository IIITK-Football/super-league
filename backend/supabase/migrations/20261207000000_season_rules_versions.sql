-- Versioned season rules, built from premade blocks.
--
-- * A season has one draft (season_rules_drafts) and numbered published versions (season_rules_versions).
-- * A version is immutable and holds exactly what visitors saw: hidden blocks stay in the draft only.
-- * Visitors read only the latest version, through season_rules(). Dictators read drafts and history. All writes go
--   through save_rules_draft() and publish_rules(), and both tables are audited.
-- * backfill_season_rules() turns the existing text (seasons.rules_md, else the rules the site showed for the three
--   original divisions) into version 1. It is repeatable: a season that has a version is never touched.
-- Forward-only.

CREATE FUNCTION public.rules_text_ok(p_value jsonb, p_max integer)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT COALESCE(jsonb_typeof(p_value) = 'string'
    AND char_length(btrim(p_value #>> '{}')) BETWEEN 1 AND p_max, false);
$$;

CREATE FUNCTION public.rules_list_ok(p_value jsonb, p_max_items integer, p_max integer)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $$
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(p_value) NOT BETWEEN 1 AND p_max_items THEN RETURN false; END IF;
  RETURN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_value) e(v) WHERE NOT public.rules_text_ok(e.v, p_max));
END;
$$;

-- section(title, body?, items?) callout(title, body, tone) steps(title?, items) table(title?, columns, rows)
-- notice(tone, body); every block also has id and hidden, and no other key.
CREATE FUNCTION public.rules_blocks_valid(p_blocks jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $$
DECLARE
  b jsonb;
  v_ids text[] := '{}';
  v_allowed text[];
  v_columns integer;
BEGIN
  IF jsonb_typeof(p_blocks) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(p_blocks) > 100 OR octet_length(p_blocks::text) > 200000 THEN RETURN false; END IF;
  FOR b IN SELECT value FROM jsonb_array_elements(p_blocks) LOOP
    IF jsonb_typeof(b) <> 'object'
      OR jsonb_typeof(b->'id') IS DISTINCT FROM 'string' OR (b->>'id') !~ '^[A-Za-z0-9-]{1,40}$'
      OR (b->>'id') = ANY (v_ids)
      OR jsonb_typeof(b->'hidden') IS DISTINCT FROM 'boolean' THEN
      RETURN false;
    END IF;
    v_ids := v_ids || (b->>'id');
    CASE b->>'type'
      WHEN 'section' THEN
        v_allowed := ARRAY['title', 'body', 'items'];
        IF NOT public.rules_text_ok(b->'title', 120)
          OR NOT (b ? 'body' OR b ? 'items')
          OR (b ? 'body' AND NOT public.rules_text_ok(b->'body', 20000))
          OR (b ? 'items' AND NOT public.rules_list_ok(b->'items', 60, 1000)) THEN RETURN false; END IF;
      WHEN 'callout' THEN
        v_allowed := ARRAY['title', 'body', 'tone'];
        IF NOT public.rules_text_ok(b->'title', 120) OR NOT public.rules_text_ok(b->'body', 5000)
          OR COALESCE(b->>'tone', '') NOT IN ('eligibility', 'info') THEN RETURN false; END IF;
      WHEN 'steps' THEN
        v_allowed := ARRAY['title', 'items'];
        IF (b ? 'title' AND NOT public.rules_text_ok(b->'title', 120))
          OR NOT public.rules_list_ok(b->'items', 60, 1000) THEN RETURN false; END IF;
      WHEN 'table' THEN
        v_allowed := ARRAY['title', 'columns', 'rows'];
        IF (b ? 'title' AND NOT public.rules_text_ok(b->'title', 120))
          OR NOT public.rules_list_ok(b->'columns', 8, 80)
          OR jsonb_typeof(b->'rows') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
        v_columns := jsonb_array_length(b->'columns');
        IF jsonb_array_length(b->'rows') NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
        -- CASE, not OR: the array functions must not run on a value that is not an array.
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(b->'rows') r(v) WHERE
          CASE WHEN jsonb_typeof(r.v) <> 'array' THEN true
               WHEN jsonb_array_length(r.v) <> v_columns THEN true
               ELSE EXISTS (SELECT 1 FROM jsonb_array_elements(r.v) c(v)
                 WHERE jsonb_typeof(c.v) <> 'string' OR char_length(c.v #>> '{}') > 500) END) THEN
          RETURN false;
        END IF;
      WHEN 'notice' THEN
        v_allowed := ARRAY['tone', 'body'];
        IF NOT public.rules_text_ok(b->'body', 5000)
          OR COALESCE(b->>'tone', '') NOT IN ('info', 'warning') THEN RETURN false; END IF;
      ELSE
        RETURN false;
    END CASE;
    IF b - (v_allowed || ARRAY['id', 'type', 'hidden']) <> '{}'::jsonb THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE TABLE public.season_rules_drafts (
  season_id uuid PRIMARY KEY REFERENCES public.seasons(id) ON DELETE CASCADE,
  blocks jsonb NOT NULL CONSTRAINT season_rules_drafts_blocks CHECK (public.rules_blocks_valid(blocks)),
  based_on_version integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE TABLE public.season_rules_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Restrict: a season with published rules keeps its history.
  season_id uuid NOT NULL REFERENCES public.seasons(id),
  version integer NOT NULL CONSTRAINT season_rules_versions_number CHECK (version > 0),
  blocks jsonb NOT NULL CONSTRAINT season_rules_versions_blocks
    CHECK (public.rules_blocks_valid(blocks) AND jsonb_array_length(blocks) > 0),
  published_at timestamptz NOT NULL DEFAULT now(),
  -- No foreign key: deleting an account must not change a published version.
  published_by uuid,
  CONSTRAINT season_rules_versions_unique UNIQUE (season_id, version)
);
COMMENT ON TABLE public.season_rules_versions IS 'Published rules. Immutable: a later change is a new version. Visitors read the latest one through season_rules().';

CREATE FUNCTION public.season_rules_version_is_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  RAISE EXCEPTION 'Published rules cannot be changed or removed' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER season_rules_versions_immutable BEFORE UPDATE OR DELETE ON public.season_rules_versions
  FOR EACH ROW EXECUTE FUNCTION public.season_rules_version_is_immutable();
CREATE TRIGGER season_rules_versions_no_truncate BEFORE TRUNCATE ON public.season_rules_versions
  FOR EACH STATEMENT EXECUTE FUNCTION public.season_rules_version_is_immutable();

CREATE TRIGGER audit_season_rules_drafts AFTER INSERT OR UPDATE OR DELETE ON public.season_rules_drafts
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('season_id');
CREATE TRIGGER audit_season_rules_versions AFTER INSERT ON public.season_rules_versions
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('season_id,version');

ALTER TABLE public.season_rules_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.season_rules_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dictators read rules drafts" ON public.season_rules_drafts FOR SELECT TO authenticated
  USING (public.is_dictator());
CREATE POLICY "Dictators read rules versions" ON public.season_rules_versions FOR SELECT TO authenticated
  USING (public.is_dictator());
REVOKE ALL ON public.season_rules_drafts, public.season_rules_versions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.season_rules_drafts, public.season_rules_versions
  FROM authenticated, service_role;
GRANT SELECT ON public.season_rules_drafts, public.season_rules_versions TO authenticated, service_role;

CREATE FUNCTION public.save_rules_draft(p_season uuid, p_blocks jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can edit rules' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.seasons WHERE id = p_season FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Season not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.rules_blocks_valid(p_blocks) THEN
    RAISE EXCEPTION 'Complete every block before saving' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.season_rules_drafts (season_id, blocks, based_on_version, updated_by)
  VALUES (p_season, p_blocks,
    (SELECT max(version) FROM public.season_rules_versions WHERE season_id = p_season), auth.uid())
  ON CONFLICT (season_id) DO UPDATE SET blocks = EXCLUDED.blocks, based_on_version = EXCLUDED.based_on_version,
    updated_at = now(), updated_by = EXCLUDED.updated_by;
END;
$$;

CREATE FUNCTION public.publish_rules(p_season uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_blocks jsonb;
  v_latest public.season_rules_versions;
  v_version integer;
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can publish rules' USING ERRCODE = '42501';
  END IF;
  -- The season lock serialises concurrent saves and publishes.
  PERFORM 1 FROM public.seasons WHERE id = p_season FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Season not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(jsonb_agg(e.v ORDER BY e.position), '[]'::jsonb) INTO v_blocks
    FROM public.season_rules_drafts d, jsonb_array_elements(d.blocks) WITH ORDINALITY AS e(v, position)
    WHERE d.season_id = p_season AND NOT (e.v->>'hidden')::boolean;
  IF jsonb_array_length(v_blocks) = 0 THEN
    RAISE EXCEPTION 'Save a draft with at least one visible block before publishing' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_latest FROM public.season_rules_versions
    WHERE season_id = p_season ORDER BY version DESC LIMIT 1;
  IF v_latest.blocks = v_blocks THEN
    RAISE EXCEPTION 'There is nothing new to publish' USING ERRCODE = '22023';
  END IF;
  v_version := COALESCE(v_latest.version, 0) + 1;
  INSERT INTO public.season_rules_versions (season_id, version, blocks, published_by)
  VALUES (p_season, v_version, v_blocks, auth.uid());
  UPDATE public.season_rules_drafts SET based_on_version = v_version WHERE season_id = p_season;
  RETURN v_version;
END;
$$;

-- The only public read: the latest version of a season a visitor can open, with the rules section switched on.
CREATE FUNCTION public.season_rules(p_season uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT jsonb_build_object('id', v.id, 'version', v.version, 'published_at', v.published_at, 'blocks', v.blocks)
  FROM public.season_rules_versions v
  JOIN public.seasons s ON s.id = v.season_id AND s.visibility = 'public' AND s.archived_at IS NULL
  JOIN public.divisions d ON d.id = s.division_id AND d.visibility = 'public' AND d.archived_at IS NULL
  WHERE v.season_id = p_season AND (public.section_flags(s) ->> 'rules')::boolean
  ORDER BY v.version DESC
  LIMIT 1;
$$;

-- The rules the site showed before they became data, per original division. Items keep their "Label: text" form.
CREATE FUNCTION public.legacy_rules_blocks(p_division_slug text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $function$
BEGIN
  IF p_division_slug = 'wsl' THEN
    RETURN $json$[
      {"id":"legacy-intro","type":"notice","hidden":false,"tone":"info","body":"Welcome to the WSL! To ensure a fair, competitive, and enjoyable tournament for all teams, please review the official match rules below."},
      {"id":"legacy-1","type":"section","hidden":false,"title":"Team & Match Format","items":[
        "Format: 5-a-side (4 outfield players + 1 goalkeeper on the pitch).",
        "Substitutions (No Return Subs): Rolling substitutions are not permitted. Once a player is substituted off the pitch, they may not re-enter the match under any circumstances.",
        "Match Duration: Matches will be played in two equal halves with a brief half-time interval.",
        "Tie-Breakers: If a knockout match ends in a draw at the end of regular time, the winner will be decided by a penalty shootout (3 penalties per team, followed by sudden death if necessary)."]},
      {"id":"legacy-2","type":"section","hidden":false,"title":"Disciplinary Rules","items":[
        "Yellow Cards: A standard warning for reckless fouls or unsporting behavior. Two yellow cards in a single match equate to a red card.",
        "Red Cards (Special Rule): If a player receives a red card, they are sent off for the remainder of the match and cannot return.",
        "Penalty Duration: The offending team must play one player short for a penalty duration of exactly 1 minute.",
        "Substitution After Red: Once the 1-minute penalty expires, the team may bring on a substitute to replace the red-carded player, bringing the team back to a full 5 players on the pitch.",
        "Condition: This is only permitted if the team has not exhausted their substitution limit for the match. If all subs have been used, the team must play the rest of the match a player down."]},
      {"id":"legacy-3","type":"section","hidden":false,"title":"Standard In-Game Rules","items":[
        "Kick-ins: When the ball goes out of play over the touchlines, play is restarted with a kick-in. Throw-ins are not permitted. The ball must be stationary on the touchline before being kicked.",
        "Goalkeeper Rules: Goalkeepers must distribute the ball by throwing or rolling it out from their hands. Punting or drop-kicking the ball is not allowed.",
        "Pass-backs: The goalkeeper cannot pick up the ball with their hands if it is intentionally passed back to them by a teammate's foot.",
        "Fouls & Free Kicks: All fouls will result in a direct or indirect free kick. Opposing players must stand a minimum of 3 meters away from the ball. Slide tackling is strictly prohibited to prevent injuries."]}
    ]$json$::jsonb;
  ELSIF p_division_slug IN ('super-league', 'freshers') THEN
    RETURN $json$[
      {"id":"legacy-intro","type":"notice","hidden":false,"tone":"info","body":"The Super League is designed to improve the quality and intensity of the existing 9v9 tournament by creating a format for top players to compete on a regular basis. With the qualifiers officially concluded, the following regulations govern the League phase."},
      {"id":"legacy-1","type":"section","hidden":false,"title":"League Format & Objective","items":[
        "The Teams: The league consists of exactly six clubs competing head-to-head. This includes the two pre-qualified inaugural clubs, MILF and HRZ, and the four clubs that advanced from the Qualifiers.",
        "The Champion: The League leader is the Super League champion."]},
      {"id":"legacy-2","type":"section","hidden":false,"title":"Rosters & Player Eligibility","items":[
        "Squad Limits: A club can have no more than 13 players. Club formation is open for all students, regardless of house, year, or batch barriers.",
        "Roster Lock: The qualifiers are officially done. Any player who was eliminated during the qualifiers cannot be recruited or play for any of the final six league clubs.",
        "Registration: No spot registrations will be permitted. Playing unregistered players is strictly prohibited."]},
      {"id":"legacy-3","type":"section","hidden":false,"title":"Match Regulations","items":[
        "Match Duration: Matches will be played with 20-minute halves.",
        "Substitutions: Teams are strictly limited to 3 substitutions per match.",
        "Punctuality: Participants must arrive at the venue as per the scheduled timings."]},
      {"id":"legacy-4","type":"section","hidden":false,"title":"Points System & Standings","items":[
        "Win: 3 Points",
        "Draw: 1 Point (each team)",
        "Loss: 0 Points",
        "Tie-Breakers: If tied on points at the end of the season, ranking order is determined by Total Points, then Goal Difference, then Goals Scored, then Head-to-Head Record."]},
      {"id":"legacy-5","type":"section","hidden":false,"title":"Disciplinary & Future Editions","items":[
        "Violations: Failure to follow rules and regulations will result in disqualification without any further opportunities.",
        "Qualification for Next Season: Top clubs directly qualify for the next edition of the Super League. To retain automatic qualification, clubs must retain a minimum of 7 players."]},
      {"id":"legacy-6","type":"section","hidden":false,"title":"Contact Information","items":[
        "Adwaith ES: 9526386860",
        "Kevin Mathew: 9072972350"]}
    ]$json$::jsonb;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE FUNCTION public.backfill_season_rules()
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
DECLARE
  v_season record;
  v_blocks jsonb;
  v_count integer := 0;
BEGIN
  FOR v_season IN
    SELECT s.id, s.rules_md, d.slug AS division_slug
    FROM public.seasons s JOIN public.divisions d ON d.id = s.division_id
    WHERE NOT EXISTS (SELECT 1 FROM public.season_rules_versions v WHERE v.season_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.season_rules_drafts r WHERE r.season_id = s.id)
    ORDER BY s.id
  LOOP
    IF btrim(COALESCE(v_season.rules_md, '')) <> '' THEN
      v_blocks := jsonb_build_array(jsonb_build_object('id', 'legacy-text', 'type', 'section', 'hidden', false,
        'title', 'Season rules', 'body', v_season.rules_md));
    ELSE
      v_blocks := public.legacy_rules_blocks(v_season.division_slug);
    END IF;
    CONTINUE WHEN v_blocks IS NULL;
    INSERT INTO public.season_rules_versions (season_id, version, blocks) VALUES (v_season.id, 1, v_blocks);
    INSERT INTO public.season_rules_drafts (season_id, blocks, based_on_version) VALUES (v_season.id, v_blocks, 1);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.save_rules_draft(uuid, jsonb), public.publish_rules(uuid),
  public.season_rules(uuid), public.backfill_season_rules(), public.legacy_rules_blocks(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_rules_draft(uuid, jsonb), public.publish_rules(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.season_rules(uuid) TO anon, authenticated;

DO $$
DECLARE
  v_expected integer;
  v_created integer;
BEGIN
  SELECT count(*) INTO v_expected FROM public.seasons s JOIN public.divisions d ON d.id = s.division_id
    WHERE btrim(COALESCE(s.rules_md, '')) <> '' OR d.slug IN ('super-league', 'wsl', 'freshers');
  v_created := public.backfill_season_rules();
  IF v_created <> v_expected THEN
    RAISE EXCEPTION 'Rules backfill wrote % of % seasons', v_created, v_expected;
  END IF;
  IF EXISTS (SELECT 1 FROM public.seasons s WHERE btrim(COALESCE(s.rules_md, '')) <> '' AND NOT EXISTS (
      SELECT 1 FROM public.season_rules_versions v
      WHERE v.season_id = s.id AND v.version = 1 AND v.blocks #>> '{0,body}' = s.rules_md)) THEN
    RAISE EXCEPTION 'A season''s rules text was not preserved';
  END IF;
  RAISE NOTICE 'Rules backfill: % seasons', v_created;
END;
$$;

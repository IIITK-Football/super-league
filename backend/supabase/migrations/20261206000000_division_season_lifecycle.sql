ALTER TABLE public.divisions ALTER COLUMN visibility SET DEFAULT 'hidden';
ALTER TABLE public.seasons ALTER COLUMN visibility SET DEFAULT 'hidden';
ALTER TABLE public.seasons ADD CONSTRAINT seasons_current_is_public
  CHECK (NOT is_current OR (visibility = 'public' AND archived_at IS NULL));
ALTER TABLE public.season_sections ADD COLUMN label text
  CHECK (label IS NULL OR char_length(btrim(label)) BETWEEN 1 AND 40);

CREATE FUNCTION public.clear_unavailable_current_season()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  IF NEW.visibility = 'hidden' OR NEW.archived_at IS NOT NULL THEN
    NEW.is_current := false;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER seasons_clear_unavailable_current BEFORE UPDATE OF visibility, archived_at ON public.seasons
  FOR EACH ROW EXECUTE FUNCTION public.clear_unavailable_current_season();

CREATE OR REPLACE FUNCTION public.set_current_season(p_season uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
DECLARE
  v_target public.seasons;
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can change the current season' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.divisions
    WHERE id = (SELECT division_id FROM public.seasons WHERE id = p_season) FOR UPDATE;
  SELECT * INTO v_target FROM public.seasons WHERE id = p_season FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Season not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_target.visibility <> 'public' OR v_target.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Publish the season before making it current' USING ERRCODE = '22023';
  END IF;
  UPDATE public.seasons SET is_current = false
    WHERE division_id = v_target.division_id AND is_current AND id <> p_season;
  UPDATE public.seasons SET is_current = true WHERE id = p_season AND NOT is_current;
  PERFORM public.refresh_captain_grants();
END;
$$;

CREATE FUNCTION public.create_division(p_fields jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can create a division' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_fields) IS DISTINCT FROM 'object'
    OR p_fields - ARRAY['slug','name','short_name','description','logo_url','primary_color','secondary_color'] <> '{}'::jsonb
    OR jsonb_typeof(p_fields->'slug') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_fields->'name') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'Invalid division fields' USING ERRCODE = '22023';
  END IF;
  IF p_fields->>'slug' IN ('admin','api','article','dictator','editor','fantasy','hq-login','leaderboard','login',
    'matches','profile','reset-password','rules','standings','team-builder','teams','vault','wc') THEN
    RAISE EXCEPTION 'This division slug is reserved' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(12973, 40);
  INSERT INTO public.divisions (slug, name, short_name, description, logo_url, primary_color, secondary_color, sort_order)
  SELECT p_fields->>'slug', btrim(p_fields->>'name'), p_fields->>'short_name', p_fields->>'description',
    p_fields->>'logo_url', p_fields->>'primary_color', p_fields->>'secondary_color',
    COALESCE(max(sort_order), 0) + 1 FROM public.divisions
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.create_season(p_division uuid, p_slug text, p_name text, p_starts_on date, p_ends_on date, p_format text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can create a season' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.divisions WHERE id = p_division FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Division not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_slug IS NULL OR p_name IS NULL OR p_format IS NULL THEN
    RAISE EXCEPTION 'Season slug, name and format are required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.seasons (division_id, slug, name, starts_on, ends_on, format, sort_order)
  SELECT p_division, p_slug, btrim(p_name), p_starts_on, p_ends_on, p_format, COALESCE(max(sort_order), 0) + 1
    FROM public.seasons WHERE division_id = p_division RETURNING id INTO v_id;
  INSERT INTO public.season_sections (season_id, section_key, enabled, nav_visible, sort_order)
  SELECT v_id, key, default_enabled, default_enabled, default_sort_order FROM public.section_types;
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.update_division(p_division uuid, p_fields jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can update a division' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_fields) IS DISTINCT FROM 'object'
    OR p_fields - ARRAY['name','short_name','description','logo_url','primary_color','secondary_color','visibility','archived'] <> '{}'::jsonb
    OR (p_fields ? 'name' AND jsonb_typeof(p_fields->'name') <> 'string')
    OR (p_fields ? 'visibility' AND jsonb_typeof(p_fields->'visibility') <> 'string')
    OR (p_fields ? 'archived' AND jsonb_typeof(p_fields->'archived') <> 'boolean') THEN
    RAISE EXCEPTION 'Invalid division fields' USING ERRCODE = '22023';
  END IF;
  UPDATE public.divisions d SET
    name = COALESCE(btrim(p_fields->>'name'), d.name),
    short_name = CASE WHEN p_fields ? 'short_name' THEN p_fields->>'short_name' ELSE d.short_name END,
    description = CASE WHEN p_fields ? 'description' THEN p_fields->>'description' ELSE d.description END,
    logo_url = CASE WHEN p_fields ? 'logo_url' THEN p_fields->>'logo_url' ELSE d.logo_url END,
    primary_color = CASE WHEN p_fields ? 'primary_color' THEN p_fields->>'primary_color' ELSE d.primary_color END,
    secondary_color = CASE WHEN p_fields ? 'secondary_color' THEN p_fields->>'secondary_color' ELSE d.secondary_color END,
    visibility = CASE WHEN p_fields ? 'archived' THEN 'hidden' ELSE COALESCE(p_fields->>'visibility', d.visibility) END,
    archived_at = CASE p_fields->>'archived' WHEN 'true' THEN COALESCE(d.archived_at, now()) WHEN 'false' THEN NULL ELSE d.archived_at END
  WHERE d.id = p_division;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Division not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

CREATE FUNCTION public.update_season(p_season uuid, p_fields jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can update a season' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_fields) IS DISTINCT FROM 'object'
    OR p_fields - ARRAY['name','starts_on','ends_on','status','format','visibility','archived'] <> '{}'::jsonb
    OR EXISTS (
      SELECT 1 FROM jsonb_each(p_fields) AS f(key, value)
      WHERE NOT CASE WHEN key = 'archived' THEN jsonb_typeof(value) = 'boolean'
        WHEN key IN ('starts_on', 'ends_on') THEN jsonb_typeof(value) IN ('null', 'string')
        ELSE jsonb_typeof(value) = 'string' END
    ) THEN
    RAISE EXCEPTION 'Invalid season fields' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.divisions
    WHERE id = (SELECT division_id FROM public.seasons WHERE id = p_season) FOR UPDATE;
  UPDATE public.seasons s SET
    name = COALESCE(btrim(p_fields->>'name'), s.name),
    starts_on = CASE WHEN p_fields ? 'starts_on' THEN (p_fields->>'starts_on')::date ELSE s.starts_on END,
    ends_on = CASE WHEN p_fields ? 'ends_on' THEN (p_fields->>'ends_on')::date ELSE s.ends_on END,
    status = COALESCE(p_fields->>'status', s.status),
    format = COALESCE(p_fields->>'format', s.format),
    visibility = CASE WHEN p_fields ? 'archived' THEN 'hidden' ELSE COALESCE(p_fields->>'visibility', s.visibility) END,
    archived_at = CASE p_fields->>'archived' WHEN 'true' THEN COALESCE(s.archived_at, now()) WHEN 'false' THEN NULL ELSE s.archived_at END
  WHERE s.id = p_season;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Season not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.refresh_captain_grants();
END;
$$;

CREATE FUNCTION public.reorder_divisions(p_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can reorder divisions' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(12973, 40);
  UPDATE public.divisions d SET sort_order = ordered.position
    FROM unnest(p_ids) WITH ORDINALITY AS ordered(id, position) WHERE d.id = ordered.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF p_ids IS NULL OR v_count <> cardinality(p_ids) OR v_count <> (SELECT count(*) FROM public.divisions) THEN
    RAISE EXCEPTION 'Provide every division exactly once' USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE FUNCTION public.reorder_seasons(p_division uuid, p_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can reorder seasons' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.divisions WHERE id = p_division FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Division not found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.seasons s SET sort_order = ordered.position
    FROM unnest(p_ids) WITH ORDINALITY AS ordered(id, position)
    WHERE s.id = ordered.id AND s.division_id = p_division;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF p_ids IS NULL OR v_count <> cardinality(p_ids)
    OR v_count <> (SELECT count(*) FROM public.seasons WHERE division_id = p_division) THEN
    RAISE EXCEPTION 'Provide every season in this division exactly once' USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE FUNCTION public.save_season_sections(p_season uuid, p_sections jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can update sections' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.seasons WHERE id = p_season FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Season not found' USING ERRCODE = 'P0002';
  END IF;
  IF jsonb_typeof(p_sections) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Provide a section list' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_sections) <> (SELECT count(*) FROM public.section_types)
    OR jsonb_array_length(p_sections) <> (SELECT count(DISTINCT value->>'section_key') FROM jsonb_array_elements(p_sections))
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_sections) AS element(value)
      WHERE jsonb_typeof(value->'section_key') IS DISTINCT FROM 'string'
        OR jsonb_typeof(value->'enabled') IS DISTINCT FROM 'boolean'
        OR jsonb_typeof(value->'nav_visible') IS DISTINCT FROM 'boolean'
        OR (value ? 'label' AND jsonb_typeof(value->'label') NOT IN ('null', 'string'))
        OR (value ? 'settings' AND jsonb_typeof(value->'settings') <> 'object')
    ) THEN
    RAISE EXCEPTION 'Provide valid settings for every section exactly once' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.season_sections (season_id, section_key, label, enabled, nav_visible, sort_order, settings)
  SELECT p_season, value->>'section_key', NULLIF(btrim(value->>'label'), ''),
    (value->>'enabled')::boolean, (value->>'nav_visible')::boolean, position,
    COALESCE(value->'settings', old.settings, '{}'::jsonb)
  FROM jsonb_array_elements(p_sections) WITH ORDINALITY AS input(value, position)
  LEFT JOIN public.season_sections old ON old.season_id = p_season AND old.section_key = value->>'section_key'
  ON CONFLICT (season_id, section_key) DO UPDATE SET label = EXCLUDED.label, enabled = EXCLUDED.enabled,
    nav_visible = EXCLUDED.nav_visible, sort_order = EXCLUDED.sort_order, settings = EXCLUDED.settings;
END;
$$;

REVOKE ALL ON FUNCTION public.create_division(jsonb), public.create_season(uuid,text,text,date,date,text),
  public.update_division(uuid,jsonb), public.update_season(uuid,jsonb), public.reorder_divisions(uuid[]),
  public.reorder_seasons(uuid,uuid[]), public.save_season_sections(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_division(jsonb), public.create_season(uuid,text,text,date,date,text),
  public.update_division(uuid,jsonb), public.update_season(uuid,jsonb), public.reorder_divisions(uuid[]),
  public.reorder_seasons(uuid,uuid[]), public.save_season_sections(uuid,jsonb) TO authenticated;

-- PostgREST computes the effective settings alongside the season, including types added after it was created.
CREATE FUNCTION public.section_flags(p_season public.seasons)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO '' AS $$
  SELECT COALESCE(jsonb_object_agg(t.key, COALESCE(s.enabled, t.default_enabled)), '{}'::jsonb)
  FROM public.section_types t
  LEFT JOIN public.season_sections s ON s.season_id = p_season.id AND s.section_key = t.key;
$$;

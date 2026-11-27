ALTER TABLE public.divisions ADD COLUMN is_featured boolean NOT NULL DEFAULT false;
ALTER TABLE public.divisions ADD COLUMN landing_video_key text
  CHECK (landing_video_key IS NULL OR landing_video_key ~ '^[A-Za-z0-9_-]{1,80}$');

-- Carry the existing media mapping into data; newly created divisions need no code change.
UPDATE public.divisions SET landing_video_key = CASE slug
  WHEN 'super-league' THEN 'superLeague1' WHEN 'wsl' THEN 'wsl1' WHEN 'freshers' THEN 'freshers1' END
WHERE slug IN ('super-league', 'wsl', 'freshers');
UPDATE public.divisions SET is_featured = true WHERE id = (
  SELECT id FROM public.divisions WHERE visibility = 'public' AND archived_at IS NULL ORDER BY sort_order, name LIMIT 1
);
ALTER TABLE public.divisions ADD CONSTRAINT featured_division_is_public
  CHECK (NOT is_featured OR (visibility = 'public' AND archived_at IS NULL));
CREATE UNIQUE INDEX divisions_one_featured ON public.divisions (is_featured) WHERE is_featured;

CREATE FUNCTION public.clear_hidden_featured_division() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  IF NEW.visibility <> 'public' OR NEW.archived_at IS NOT NULL THEN NEW.is_featured := false; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER divisions_clear_hidden_featured BEFORE UPDATE OF visibility, archived_at ON public.divisions
  FOR EACH ROW EXECUTE FUNCTION public.clear_hidden_featured_division();

CREATE FUNCTION public.set_featured_division(p_division uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can select the featured division' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(12973, 41);
  IF NOT EXISTS (SELECT 1 FROM public.divisions WHERE id = p_division AND visibility = 'public' AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'Publish the division before making it current' USING ERRCODE = '22023';
  END IF;
  UPDATE public.divisions SET is_featured = false WHERE is_featured AND id <> p_division;
  UPDATE public.divisions SET is_featured = true WHERE id = p_division;
END;
$$;
REVOKE ALL ON FUNCTION public.set_featured_division(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_featured_division(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_division(p_division uuid, p_fields jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can update a division' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_fields) IS DISTINCT FROM 'object'
    OR p_fields - ARRAY['name','short_name','description','logo_url','primary_color','secondary_color','visibility','archived','landing_video_key'] <> '{}'::jsonb
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
    landing_video_key = CASE WHEN p_fields ? 'landing_video_key' THEN p_fields->>'landing_video_key' ELSE d.landing_video_key END,
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


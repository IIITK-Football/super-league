-- Rules now live in season_rules_versions (20261207000000 migrated and verified every season's text), so the old
-- column is removed. The backfill keeps working for seeded seasons of the three original divisions.
-- Forward-only. Ships only with a site that no longer reads the column.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.seasons s WHERE btrim(COALESCE(s.rules_md, '')) <> ''
      AND NOT EXISTS (SELECT 1 FROM public.season_rules_versions v WHERE v.season_id = s.id)) THEN
    RAISE EXCEPTION 'A season still holds rules text that has no published version';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.backfill_season_rules()
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
DECLARE
  v_season record;
  v_blocks jsonb;
  v_count integer := 0;
BEGIN
  FOR v_season IN
    SELECT s.id, d.slug AS division_slug
    FROM public.seasons s JOIN public.divisions d ON d.id = s.division_id
    WHERE NOT EXISTS (SELECT 1 FROM public.season_rules_versions v WHERE v.season_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.season_rules_drafts r WHERE r.season_id = s.id)
    ORDER BY s.id
  LOOP
    v_blocks := public.legacy_rules_blocks(v_season.division_slug);
    CONTINUE WHEN v_blocks IS NULL;
    INSERT INTO public.season_rules_versions (season_id, version, blocks) VALUES (v_season.id, 1, v_blocks);
    INSERT INTO public.season_rules_drafts (season_id, blocks, based_on_version) VALUES (v_season.id, v_blocks, 1);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

ALTER TABLE public.seasons DROP COLUMN rules_md;

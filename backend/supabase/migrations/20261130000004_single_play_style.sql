-- One play style per player (owner decision 2026-11-19): attributes.playStyle is a single name from the play-style
-- catalog (frontend/src/data/playStyles.js; a tooling test keeps the two lists identical), or absent when not set.
-- There are no lists of play styles any more. Every stored one-entry list is converted once; the conversion stops,
-- changing nothing, if a player has more than one entry or a name outside the catalog. From then on the check refuses
-- a list and any name outside the catalog, on every write.

CREATE FUNCTION public.play_style_names()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$ SELECT ARRAY['Acrobatic', 'Aerial Fortress', 'Anticipate', 'Block', 'Chip Shot', 'Cross Claimer', 'Dead Ball', 'Deflector', 'Enforcer', 'Far Reach', 'Far Throw', 'Finesse Shot', 'First Touch', 'Footwork', 'Gamechanger', 'Incisive Pass', 'Intercept', 'Inventive', 'Jockey', 'Long Ball Pass', 'Long Throw', 'Low Driven Shot', 'Pinged Pass', 'Power Shot', 'Precision Header', 'Press Proven', 'Quick Step', 'Rapid', 'Relentless', 'Rush Out', 'Slide Tackle', 'Technical', 'Tiki Taka', 'Trickster']::text[] $$;
GRANT EXECUTE ON FUNCTION public.play_style_names() TO anon, authenticated, service_role;

-- Converts stored lists of play styles to the single value. Matching is case-insensitive and ignores a trailing "+".
-- Stops with nothing changed when any list has more than one entry, an entry without a name, or a non-catalog name.
CREATE FUNCTION public.convert_play_styles()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  n integer;
  bad integer;
BEGIN
  SELECT count(*) INTO bad FROM public.players p
  WHERE p.attributes ? 'playStyles'
    AND (jsonb_typeof(p.attributes -> 'playStyles') <> 'array'
         OR jsonb_array_length(p.attributes -> 'playStyles') > 1
         OR (jsonb_array_length(p.attributes -> 'playStyles') = 1 AND NOT EXISTS (
               SELECT 1 FROM unnest(public.play_style_names()) AS c(name)
               WHERE lower(c.name) = lower(regexp_replace(btrim(p.attributes -> 'playStyles' -> 0 ->> 'name'), '\+$', '')))));
  IF bad > 0 THEN
    RAISE EXCEPTION '% player(s) have play styles that are not a single catalog play style; nothing was changed', bad;
  END IF;
  UPDATE public.players p
  SET attributes = (p.attributes - 'playStyles') || CASE
        WHEN jsonb_array_length(p.attributes -> 'playStyles') = 1 THEN jsonb_build_object('playStyle', (
          SELECT c.name FROM unnest(public.play_style_names()) AS c(name)
          WHERE lower(c.name) = lower(regexp_replace(btrim(p.attributes -> 'playStyles' -> 0 ->> 'name'), '\+$', ''))))
        ELSE '{}'::jsonb END
  WHERE p.attributes ? 'playStyles';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.convert_play_styles() FROM PUBLIC, anon, authenticated;

-- The canonical conversion of older card values (flat stats, foot spelling) stays; its play-style list handling is
-- removed.
CREATE OR REPLACE FUNCTION public.canonical_player_attributes(a jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $$
DECLARE
  stat text;
  flat text;
  v jsonb;
  result jsonb;
  stats jsonb;
  bio jsonb;
  legacy jsonb := '{}'::jsonb;
  foot text;
  k text;
BEGIN
  IF a IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(a) <> 'object' THEN RETURN jsonb_build_object('legacy', jsonb_build_object('attributes', a)); END IF;
  result := a;
  IF result ? 'legacy' AND jsonb_typeof(result -> 'legacy') = 'object' THEN legacy := result -> 'legacy'; END IF;

  stats := CASE WHEN jsonb_typeof(result -> 'stats') = 'object' THEN result -> 'stats' ELSE '{}'::jsonb END;
  IF result ? 'stats' AND jsonb_typeof(result -> 'stats') <> 'object' THEN legacy := legacy || jsonb_build_object('stats', result -> 'stats'); END IF;
  -- Unknown stat names and malformed stat entries are kept aside.
  FOR k IN SELECT jsonb_object_keys(stats) LOOP
    IF k NOT IN ('Pace', 'Shooting', 'Passing', 'Dribbling', 'Defending', 'Physicality')
       OR jsonb_typeof(stats -> k) <> 'object'
       OR (stats -> k ? 'total' AND NOT (jsonb_typeof(stats -> k -> 'total') = 'number'
                                         AND (stats -> k ->> 'total')::numeric = trunc((stats -> k ->> 'total')::numeric)
                                         AND (stats -> k ->> 'total')::numeric BETWEEN 1 AND 99)) THEN
      legacy := legacy || jsonb_build_object('stats_' || k, stats -> k);
      stats := stats - k;
    END IF;
  END LOOP;
  -- Flat numbers move into stats.<Stat>.total when that place is free and the value fits.
  FOREACH stat IN ARRAY ARRAY['Pace', 'Shooting', 'Passing', 'Dribbling', 'Defending', 'Physicality'] LOOP
    flat := lower(stat);
    IF result ? flat THEN
      v := result -> flat;
      IF jsonb_typeof(v) = 'number' AND (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric) AND (v #>> '{}')::numeric BETWEEN 1 AND 99
         AND NOT coalesce(stats -> stat ? 'total', false) THEN
        stats := stats || jsonb_build_object(stat, coalesce(stats -> stat, '{}'::jsonb) || jsonb_build_object('total', v));
      ELSE
        legacy := legacy || jsonb_build_object(flat, v);
      END IF;
      result := result - flat;
    END IF;
  END LOOP;
  result := CASE WHEN stats = '{}'::jsonb THEN result - 'stats' ELSE jsonb_set(result, '{stats}', stats) END;

  IF result ? 'bio' THEN
    IF jsonb_typeof(result -> 'bio') <> 'object' THEN
      legacy := legacy || jsonb_build_object('bio', result -> 'bio');
      result := result - 'bio';
    ELSIF result -> 'bio' ? 'preferredFoot' THEN
      bio := result -> 'bio';
      foot := initcap(btrim(bio ->> 'preferredFoot'));
      IF jsonb_typeof(bio -> 'preferredFoot') = 'string' AND foot IN ('Right', 'Left', 'Both') THEN
        result := jsonb_set(result, '{bio,preferredFoot}', to_jsonb(foot));
      ELSE
        legacy := legacy || jsonb_build_object('preferredFoot', bio -> 'preferredFoot');
        result := jsonb_set(result, '{bio}', bio - 'preferredFoot');
      END IF;
    END IF;
  END IF;


  RETURN CASE WHEN legacy = '{}'::jsonb THEN result - 'legacy' ELSE jsonb_set(result, '{legacy}', legacy) END;
END;
$$;

-- The canonical shape no longer knows lists: play styles are checked here, not converted.
CREATE OR REPLACE FUNCTION public.player_attributes_are_canonical(a jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT a IS NULL OR (
    jsonb_typeof(a) = 'object'
    AND a = public.canonical_player_attributes(a)
    AND NOT a ? 'playStyles'
    AND (NOT a ? 'playStyle' OR (jsonb_typeof(a -> 'playStyle') = 'string' AND a ->> 'playStyle' = ANY (public.play_style_names())))
  );
$$;

ALTER TABLE public.players DROP CONSTRAINT players_attributes_canonical;
DO $$
DECLARE n integer;
BEGIN
  n := public.convert_play_styles();
  RAISE NOTICE 'play style lists converted to a single play style: %', n;
END;
$$;
ALTER TABLE public.players ADD CONSTRAINT players_attributes_canonical CHECK (public.player_attributes_are_canonical(attributes));

-- One canonical shape for the FUT card fields in players.attributes (the reusable player identity, shared across
-- seasons). It is the shape the player page, the team builder and the dictator form use:
--   { "stats":      { "Pace" | "Shooting" | "Passing" | "Dribbling" | "Defending" | "Physicality": { "total": 1..99, ... } },
--     "bio":        { "preferredFoot": "Right" | "Left" | "Both", ... },
--     "playStyles": [ { "name": text, "description": text, "icon_url": text }, ... ],
--     ...any other key }
-- Older rows hold flat numbers ({"pace": 59}). They are converted here; nothing is dropped: a value that cannot take
-- its canonical place (a conflict with an existing canonical value, a non-integer or out-of-range number, an unknown
-- foot, a malformed list) is kept under "legacy". From now on the shape is checked on every write.

-- Converts any stored attributes value to the canonical shape (idempotent).
CREATE FUNCTION public.canonical_player_attributes(a jsonb)
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

  IF result ? 'playStyles' AND (jsonb_typeof(result -> 'playStyles') <> 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(result -> 'playStyles') s
                WHERE jsonb_typeof(s) <> 'object' OR jsonb_typeof(s -> 'name') IS DISTINCT FROM 'string')) THEN
    legacy := legacy || jsonb_build_object('playStyles', result -> 'playStyles');
    result := result - 'playStyles';
  END IF;

  RETURN CASE WHEN legacy = '{}'::jsonb THEN result - 'legacy' ELSE jsonb_set(result, '{legacy}', legacy) END;
END;
$$;

-- True when attributes are in the canonical shape (what the check below enforces).
CREATE FUNCTION public.player_attributes_are_canonical(a jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT a IS NULL OR (jsonb_typeof(a) = 'object' AND a = public.canonical_player_attributes(a));
$$;

DO $$
DECLARE
  n integer;
BEGIN
  UPDATE public.players SET attributes = public.canonical_player_attributes(attributes)
  WHERE attributes IS DISTINCT FROM public.canonical_player_attributes(attributes);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'player attributes converted to the canonical shape: %', n;
END;
$$;

ALTER TABLE public.players ADD CONSTRAINT players_attributes_canonical CHECK (public.player_attributes_are_canonical(attributes));

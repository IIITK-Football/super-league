-- One-time conversion of legacy free-text play styles to catalog names, run on a project that has NOT yet applied
-- 20261130000004_single_play_style (that migration accepts only one catalog play style per player and stops, changing
-- nothing, on any other name).
--
-- Why (found in the production rehearsal, 2026-11-19): until 8 October 2026 the admin player form and the captains'
-- Team Builder took a typed play-style name (with a custom icon), so 16 production players hold names that are not in
-- the 34-name catalog (frontend/src/data/playStyles.js). Every player has at most one play style.
--
-- Owner decision 2026-11-19: map the unambiguous names to their catalog equivalent; give the goalkeeper ones Deflector
-- and every other one Technical:
--   Far Reach (GK) -> Far Reach        Long Pass -> Long Ball Pass       Power Header -> Precision Header
--   Aerial -> Aerial Fortress          Lightning Reflexes, Kick Save -> Deflector
--   Whipped Pass, Professional Yapper, Toe Poke, Snap Shot, Bruiser -> Technical
-- Any other name outside the catalog stops the script with nothing changed, so an unexpected name is never guessed.
--
-- Target: public.players.attributes -> 'playStyles' only, for players whose one play style is not a catalog name (case
-- and a trailing "+" ignored, as the migration matches). The entry becomes {"name": <catalog name>}; its custom
-- description and icon go (the single-play-style migration drops them for every player anyway). Every other key of
-- attributes is kept. The catalog list below must equal public.play_style_names() (a tooling test checks it).
-- Safeguards:
-- * a name outside the catalog and the agreed list, or a player with several play styles, stops it with nothing changed;
-- * inside the transaction the table is locked and the list is checked again: if any listed entry changed, or a new
--   non-catalog name appeared, it stops with nothing changed;
-- * a row is updated only if it still holds the listed old entry.
-- Running it again changes nothing (the list is empty).
--
-- How to run (owner, production SQL Editor, after the manual export, immediately before approving the production
-- database job; docs/release.md):
-- 1. Preview: run it with the COMMIT line below changed to ROLLBACK. Nothing is written; the list is shown.
-- 2. Run it as is. The result is the list of changes (player id, old name, new name and the complete old entry with its
--    description and icon; no personal data). Export it: it is the rollback record (restore old_entry as the one
--    playStyles element for each listed id).
-- It is never run by CI or by the assistant against a hosted project.
DROP TABLE IF EXISTS pg_temp._play_style_catalog, pg_temp._play_style_map, pg_temp._play_style_changes;
CREATE TEMP TABLE _play_style_catalog AS
SELECT unnest(ARRAY['Acrobatic', 'Aerial Fortress', 'Anticipate', 'Block', 'Chip Shot', 'Cross Claimer', 'Dead Ball',
  'Deflector', 'Enforcer', 'Far Reach', 'Far Throw', 'Finesse Shot', 'First Touch', 'Footwork', 'Gamechanger',
  'Incisive Pass', 'Intercept', 'Inventive', 'Jockey', 'Long Ball Pass', 'Long Throw', 'Low Driven Shot', 'Pinged Pass',
  'Power Shot', 'Precision Header', 'Press Proven', 'Quick Step', 'Rapid', 'Relentless', 'Rush Out', 'Slide Tackle',
  'Technical', 'Tiki Taka', 'Trickster']) AS name;

CREATE TEMP TABLE _play_style_map AS
SELECT lower(legacy) AS legacy, catalog FROM (VALUES
  ('Far Reach (GK)', 'Far Reach'), ('Long Pass', 'Long Ball Pass'), ('Power Header', 'Precision Header'),
  ('Aerial', 'Aerial Fortress'), ('Lightning Reflexes', 'Deflector'), ('Kick Save', 'Deflector'),
  ('Whipped Pass', 'Technical'), ('Professional Yapper', 'Technical'), ('Toe Poke', 'Technical'),
  ('Snap Shot', 'Technical'), ('Bruiser', 'Technical')) AS m(legacy, catalog);

-- Players whose one play style is not a catalog name (case and a trailing "+" ignored, as the migration matches).
CREATE TEMP TABLE _play_style_changes AS
SELECT p.id AS player_id, p.attributes -> 'playStyles' -> 0 ->> 'name' AS old_name, m.catalog AS new_name,
       p.attributes -> 'playStyles' -> 0 AS old_entry
FROM public.players p
LEFT JOIN _play_style_map m ON m.legacy = lower(btrim(p.attributes -> 'playStyles' -> 0 ->> 'name'))
WHERE jsonb_typeof(p.attributes -> 'playStyles') = 'array'
  AND jsonb_array_length(p.attributes -> 'playStyles') = 1
  AND NOT EXISTS (SELECT 1 FROM _play_style_catalog c
                  WHERE lower(c.name) = lower(regexp_replace(btrim(p.attributes -> 'playStyles' -> 0 ->> 'name'), '\+$', '')));

BEGIN;
LOCK TABLE public.players IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  v_unknown integer;
  v_multiple integer;
  v_changed integer;
  v_new integer;
BEGIN
  SELECT count(*) INTO v_unknown FROM _play_style_changes WHERE new_name IS NULL;
  SELECT count(*) INTO v_multiple FROM public.players
  WHERE jsonb_typeof(attributes -> 'playStyles') = 'array' AND jsonb_array_length(attributes -> 'playStyles') > 1;
  IF v_unknown > 0 OR v_multiple > 0 THEN
    RAISE EXCEPTION 'Play-style conversion stopped: % player(s) with a name outside the catalog and the agreed list, % with several play styles. Nothing was changed.', v_unknown, v_multiple;
  END IF;
  -- The list must still describe the database exactly.
  SELECT count(*) INTO v_changed FROM _play_style_changes c
  WHERE NOT EXISTS (SELECT 1 FROM public.players p WHERE p.id = c.player_id AND p.attributes -> 'playStyles' -> 0 = c.old_entry
                      AND jsonb_array_length(p.attributes -> 'playStyles') = 1);
  SELECT count(*) INTO v_new FROM public.players p
  WHERE jsonb_typeof(p.attributes -> 'playStyles') = 'array' AND jsonb_array_length(p.attributes -> 'playStyles') = 1
    AND NOT EXISTS (SELECT 1 FROM _play_style_catalog c
                    WHERE lower(c.name) = lower(regexp_replace(btrim(p.attributes -> 'playStyles' -> 0 ->> 'name'), '\+$', '')))
    AND p.id NOT IN (SELECT player_id FROM _play_style_changes);
  IF v_changed > 0 OR v_new > 0 THEN
    RAISE EXCEPTION 'Play-style conversion stopped: the data changed since the list was made (% listed entries changed, % new). Nothing was changed; run it again.', v_changed, v_new;
  END IF;
  RAISE NOTICE 'Play styles converted to catalog names: %', (SELECT count(*) FROM _play_style_changes);
END;
$$;

UPDATE public.players p
SET attributes = jsonb_set(p.attributes, '{playStyles}', jsonb_build_array(jsonb_build_object('name', c.new_name)))
FROM _play_style_changes c
WHERE p.id = c.player_id AND p.attributes -> 'playStyles' -> 0 = c.old_entry;

COMMIT;

SELECT player_id, old_name, new_name, old_entry FROM _play_style_changes ORDER BY player_id;

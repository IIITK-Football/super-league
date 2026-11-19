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
-- What it does, in one transaction: rewrites the one entry of attributes.playStyles to {"name": <catalog name>} for
-- exactly those players (their custom description and icon go, as the single-play-style migration drops them anyway),
-- and lists each change (player id, old name, new name; no personal data): export that result. Running it again changes
-- nothing. The catalog list below must equal public.play_style_names() (a tooling test checks it).
--
-- Production: the owner runs this in the SQL Editor after the manual export and immediately before approving the
-- production database job (docs/release.md). It is never run by CI or by the assistant against a hosted project.
BEGIN;

CREATE TEMP TABLE _play_style_catalog ON COMMIT DROP AS
SELECT unnest(ARRAY['Acrobatic', 'Aerial Fortress', 'Anticipate', 'Block', 'Chip Shot', 'Cross Claimer', 'Dead Ball',
  'Deflector', 'Enforcer', 'Far Reach', 'Far Throw', 'Finesse Shot', 'First Touch', 'Footwork', 'Gamechanger',
  'Incisive Pass', 'Intercept', 'Inventive', 'Jockey', 'Long Ball Pass', 'Long Throw', 'Low Driven Shot', 'Pinged Pass',
  'Power Shot', 'Precision Header', 'Press Proven', 'Quick Step', 'Rapid', 'Relentless', 'Rush Out', 'Slide Tackle',
  'Technical', 'Tiki Taka', 'Trickster']) AS name;

CREATE TEMP TABLE _play_style_map ON COMMIT DROP AS
SELECT lower(legacy) AS legacy, catalog FROM (VALUES
  ('Far Reach (GK)', 'Far Reach'), ('Long Pass', 'Long Ball Pass'), ('Power Header', 'Precision Header'),
  ('Aerial', 'Aerial Fortress'), ('Lightning Reflexes', 'Deflector'), ('Kick Save', 'Deflector'),
  ('Whipped Pass', 'Technical'), ('Professional Yapper', 'Technical'), ('Toe Poke', 'Technical'),
  ('Snap Shot', 'Technical'), ('Bruiser', 'Technical')) AS m(legacy, catalog);

-- Players whose one play style is not a catalog name (case and a trailing "+" ignored, as the migration matches).
CREATE TEMP TABLE _play_style_changes ON COMMIT DROP AS
SELECT p.id AS player_id, p.attributes -> 'playStyles' -> 0 ->> 'name' AS old_name, m.catalog AS new_name
FROM public.players p
LEFT JOIN _play_style_map m ON m.legacy = lower(btrim(p.attributes -> 'playStyles' -> 0 ->> 'name'))
WHERE jsonb_typeof(p.attributes -> 'playStyles') = 'array'
  AND jsonb_array_length(p.attributes -> 'playStyles') = 1
  AND NOT EXISTS (SELECT 1 FROM _play_style_catalog c
                  WHERE lower(c.name) = lower(regexp_replace(btrim(p.attributes -> 'playStyles' -> 0 ->> 'name'), '\+$', '')));

DO $$
DECLARE
  v_unknown integer;
  v_multiple integer;
BEGIN
  SELECT count(*) INTO v_unknown FROM _play_style_changes WHERE new_name IS NULL;
  SELECT count(*) INTO v_multiple FROM public.players
  WHERE jsonb_typeof(attributes -> 'playStyles') = 'array' AND jsonb_array_length(attributes -> 'playStyles') > 1;
  IF v_unknown > 0 OR v_multiple > 0 THEN
    RAISE EXCEPTION 'Play-style conversion stopped: % player(s) with a name outside the catalog and the agreed list, % with several play styles. Nothing was changed.', v_unknown, v_multiple;
  END IF;
  RAISE NOTICE 'Play styles converted to catalog names: %', (SELECT count(*) FROM _play_style_changes);
END;
$$;

UPDATE public.players p
SET attributes = jsonb_set(p.attributes, '{playStyles}', jsonb_build_array(jsonb_build_object('name', c.new_name)))
FROM _play_style_changes c
WHERE p.id = c.player_id;

SELECT player_id, old_name, new_name FROM _play_style_changes ORDER BY player_id;

COMMIT;

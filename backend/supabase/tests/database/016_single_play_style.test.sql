-- Group: database. A player has exactly one play style from the catalog, or none: attributes.playStyle is a catalog
-- name. Arrays are refused, and so are names outside the catalog. The one-time conversion turns a one-entry array into
-- the single value and stops, changing nothing, if any player has more than one entry or a name outside the catalog.
-- Rolled back.
BEGIN;
SELECT plan(10);

SELECT is(cardinality(public.play_style_names()), 34, 'the catalog has its 34 play styles');
SELECT ok('Power Shot' = ANY (public.play_style_names()), 'catalog names are stored exactly as in the frontend catalog');

INSERT INTO public.players (id, first_name, last_name) VALUES ('b1600000-0000-4000-8000-000000000001', 'Style', 'Check');
SELECT lives_ok($$UPDATE public.players SET attributes = '{"playStyle": "Power Shot"}' WHERE id = 'b1600000-0000-4000-8000-000000000001'$$,
  'one catalog play style is accepted');
SELECT lives_ok($$UPDATE public.players SET attributes = '{}' WHERE id = 'b1600000-0000-4000-8000-000000000001'$$, 'no play style is accepted');
SELECT throws_ok($$UPDATE public.players SET attributes = '{"playStyles": [{"name": "Power Shot"}]}' WHERE id = 'b1600000-0000-4000-8000-000000000001'$$,
  '23514', NULL, 'a list of play styles is refused');
SELECT throws_ok($$UPDATE public.players SET attributes = '{"playStyle": "Mystery Move"}' WHERE id = 'b1600000-0000-4000-8000-000000000001'$$,
  '23514', NULL, 'a name outside the catalog is refused');
SELECT throws_ok($$UPDATE public.players SET attributes = '{"playStyle": ["Power Shot"]}' WHERE id = 'b1600000-0000-4000-8000-000000000001'$$,
  '23514', NULL, 'a play style that is not a single name is refused');

-- The one-time conversion, on rows written as before (the check is lifted inside this rolled-back test only).
ALTER TABLE public.players DROP CONSTRAINT players_attributes_canonical;
UPDATE public.players SET attributes = '{"playStyles": [{"name": "power shot+", "icon_url": "x"}], "bio": {"preferredFoot": "Left"}}' WHERE id = 'b1600000-0000-4000-8000-000000000001';
SELECT lives_ok($$SELECT public.convert_play_styles()$$, 'a one-entry list converts');
SELECT is((SELECT attributes FROM public.players WHERE id = 'b1600000-0000-4000-8000-000000000001'),
  '{"playStyle": "Power Shot", "bio": {"preferredFoot": "Left"}}'::jsonb, 'into the single catalog value, keeping everything else');
UPDATE public.players SET attributes = '{"playStyles": [{"name": "Power Shot"}, {"name": "Tiki Taka"}]}' WHERE id = 'b1600000-0000-4000-8000-000000000001';
SELECT throws_ok($$SELECT public.convert_play_styles()$$, 'P0001', NULL, 'more than one play style stops the conversion with nothing changed');

SELECT * FROM finish();
ROLLBACK;

-- Group: database. One canonical shape for the FUT card fields in players.attributes: older flat numbers convert into
-- stats, whatever cannot take its canonical place is kept under legacy (nothing dropped), conversion is idempotent,
-- every stored row is canonical, and a write in any other shape is refused. Rolled back.
BEGIN;
SELECT plan(9);

SELECT is(public.canonical_player_attributes('{"pace": 59, "passing": 57, "shooting": 63}'),
  '{"stats": {"Pace": {"total": 59}, "Passing": {"total": 57}, "Shooting": {"total": 63}}}'::jsonb,
  'flat numbers move into stats');
SELECT is(public.canonical_player_attributes(
  '{"pace": 59, "stats": {"Pace": {"total": 60}, "Speed": {"total": 1}, "Passing": {"total": 120}}, "shooting": "high",
    "bio": {"preferredFoot": "left", "height": 170}, "other": [1]}'),
  '{"stats": {"Pace": {"total": 60}}, "bio": {"preferredFoot": "Left", "height": 170}, "other": [1],
    "legacy": {"pace": 59, "shooting": "high", "stats_Speed": {"total": 1}, "stats_Passing": {"total": 120}}}'::jsonb,
  'what cannot take its canonical place is kept under legacy, nothing is dropped');
SELECT is(public.canonical_player_attributes('{"bio": {"preferredFoot": "sideways"}}'), '{"bio": {}, "legacy": {"preferredFoot": "sideways"}}'::jsonb,
  'an unknown foot is kept under legacy');
SELECT is(public.canonical_player_attributes('[1, 2]'), '{"legacy": {"attributes": [1, 2]}}'::jsonb, 'a non-object value is kept under legacy');
SELECT is(public.canonical_player_attributes(public.canonical_player_attributes('{"pace": 59, "stats": {"Pace": {"total": 60}}}')),
  public.canonical_player_attributes('{"pace": 59, "stats": {"Pace": {"total": 60}}}'), 'conversion is idempotent');
SELECT is((SELECT count(*)::int FROM public.players WHERE NOT public.player_attributes_are_canonical(attributes)), 0, 'every stored player is canonical');

INSERT INTO public.players (id, first_name, last_name) VALUES ('b0000000-0000-4000-8000-0000000000a1', 'Shape', 'Check');
SELECT throws_ok($$UPDATE public.players SET attributes = '{"pace": 80}' WHERE id = 'b0000000-0000-4000-8000-0000000000a1'$$,
  '23514', NULL, 'a flat stat is refused');
SELECT throws_ok($$UPDATE public.players SET attributes = '{"stats": {"Pace": {"total": 120}}}' WHERE id = 'b0000000-0000-4000-8000-0000000000a1'$$,
  '23514', NULL, 'an out-of-range stat is refused');
SELECT lives_ok($$UPDATE public.players SET attributes = '{"stats": {"Pace": {"total": 80}}, "bio": {"preferredFoot": "Both"}, "playStyle": "Power Shot"}'
  WHERE id = 'b0000000-0000-4000-8000-0000000000a1'$$, 'the canonical shape is accepted');

SELECT * FROM finish();
ROLLBACK;

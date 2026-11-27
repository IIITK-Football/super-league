BEGIN;
SELECT plan(25);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('c2700000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'rules-dictator@iiitkottayam.ac.in'),
  ('c2700000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'rules-editor@iiitkottayam.ac.in');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c2700000-0000-4000-8000-000000000001', 'dictator'),
  ('c2700000-0000-4000-8000-000000000002', 'editor');

-- Backfill: an original division keeps the rules the site showed, a season with text keeps the text, others get none.
INSERT INTO public.divisions (id, slug, name, visibility) VALUES
  ('c2700000-0000-4000-8000-00000000000d', 'rules-test', 'Rules test', 'public');
INSERT INTO public.seasons (id, division_id, slug, name, visibility, rules_md) VALUES
  ('c2700000-0000-4000-8000-0000000000a1', 'c2700000-0000-4000-8000-00000000000d', 'text', 'Text', 'public', E'Line one\nLine two'),
  ('c2700000-0000-4000-8000-0000000000a2', 'c2700000-0000-4000-8000-00000000000d', 'none', 'None', 'public', NULL);

SELECT is(public.backfill_season_rules(), 1, 'only the season with text is backfilled');
SELECT is(public.backfill_season_rules(), 0, 'the backfill is repeatable');
SELECT is((SELECT blocks #>> '{0,body}' FROM season_rules_versions WHERE season_id = 'c2700000-0000-4000-8000-0000000000a1'),
  E'Line one\nLine two', 'the text is preserved verbatim');
SELECT ok(public.rules_blocks_valid(public.legacy_rules_blocks('wsl'))
  AND public.rules_blocks_valid(public.legacy_rules_blocks('super-league')), 'the migrated rule sets are valid');
SELECT is((SELECT count(*) FROM seasons s JOIN divisions d ON d.id = s.division_id
  WHERE d.slug IN ('super-league', 'wsl', 'freshers')
    AND NOT EXISTS (SELECT 1 FROM season_rules_versions v WHERE v.season_id = s.id)), 0::bigint,
  'every season of the original divisions has rules');

SELECT ok(public.rules_blocks_valid($$[
  {"id":"a","type":"section","hidden":false,"title":"T","body":"B"},
  {"id":"b","type":"callout","hidden":false,"title":"T","body":"B","tone":"eligibility"},
  {"id":"c","type":"steps","hidden":true,"items":["one","two"]},
  {"id":"d","type":"table","hidden":false,"columns":["A","B"],"rows":[["1",""]]},
  {"id":"e","type":"notice","hidden":false,"tone":"warning","body":"B"}]$$::jsonb), 'every block type is accepted');
SELECT ok(NOT public.rules_blocks_valid('[{"id":"a","type":"html","hidden":false,"body":"x"}]'), 'unknown types are refused');
SELECT ok(NOT public.rules_blocks_valid('[{"id":"a","type":"notice","hidden":false,"tone":"info","body":" "}]'), 'blank fields are refused');
SELECT ok(NOT public.rules_blocks_valid('[{"id":"a","type":"notice","hidden":false,"tone":"info","body":"x","script":"y"}]'), 'unknown keys are refused');
SELECT ok(NOT public.rules_blocks_valid('[{"id":"a","type":"table","hidden":false,"columns":["A","B"],"rows":[["1"]]}]'), 'ragged tables are refused');
SELECT ok(NOT public.rules_blocks_valid('[{"id":"a","type":"table","hidden":false,"columns":["A"],"rows":["1"]}]'), 'a row that is not a list is refused');
SELECT ok(NOT public.rules_blocks_valid('[{"id":"a","type":"steps","hidden":false,"items":["x"]},{"id":"a","type":"steps","hidden":false,"items":["y"]}]'), 'duplicate ids are refused');

SELECT set_config('request.jwt.claim.sub', 'c2700000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT public.save_rules_draft('c2700000-0000-4000-8000-0000000000a2', $$[
  {"id":"a","type":"notice","hidden":false,"tone":"info","body":"First"},
  {"id":"b","type":"notice","hidden":true,"tone":"info","body":"Hidden"}]$$);
SELECT is(public.season_rules('c2700000-0000-4000-8000-0000000000a2'), NULL, 'a draft is not public');
SELECT is(public.publish_rules('c2700000-0000-4000-8000-0000000000a2'), 1, 'publishing makes version 1');
SELECT is(jsonb_array_length(public.season_rules('c2700000-0000-4000-8000-0000000000a2') -> 'blocks'), 1, 'hidden blocks are left out');
SELECT throws_ok($$SELECT public.publish_rules('c2700000-0000-4000-8000-0000000000a2')$$, '22023', NULL, 'an unchanged draft is refused');
SELECT public.save_rules_draft('c2700000-0000-4000-8000-0000000000a2', '[{"id":"a","type":"notice","hidden":false,"tone":"info","body":"Second"}]');
SELECT is(public.season_rules('c2700000-0000-4000-8000-0000000000a2') #>> '{blocks,0,body}', 'First', 'editing a draft changes nothing public');
SELECT is(public.publish_rules('c2700000-0000-4000-8000-0000000000a2'), 2, 'publishing again makes version 2');
SELECT is((SELECT blocks #>> '{0,body}' FROM season_rules_versions
  WHERE season_id = 'c2700000-0000-4000-8000-0000000000a2' AND version = 1), 'First', 'the previous version is unchanged');
SELECT throws_ok($$UPDATE season_rules_versions SET blocks = blocks$$, '42501', NULL, 'a dictator cannot write versions directly');
RESET ROLE;
SELECT throws_ok($$DELETE FROM season_rules_versions WHERE season_id = 'c2700000-0000-4000-8000-0000000000a2'$$,
  '42501', NULL, 'versions are immutable even for the database owner');
SELECT is((SELECT count(*) FROM audit_log WHERE table_name = 'season_rules_versions'
  AND actor_id = 'c2700000-0000-4000-8000-000000000001'), 2::bigint, 'publishing is audited with the dictator as actor');

SELECT set_config('request.jwt.claim.sub', 'c2700000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.publish_rules('c2700000-0000-4000-8000-0000000000a2')$$, '42501', NULL, 'an editor cannot publish');
SELECT is((SELECT count(*) FROM season_rules_versions) + (SELECT count(*) FROM season_rules_drafts), 0::bigint,
  'drafts and history are private to dictators');
RESET ROLE;

UPDATE public.seasons SET visibility = 'hidden' WHERE id = 'c2700000-0000-4000-8000-0000000000a2';
SET LOCAL ROLE anon;
SELECT is(public.season_rules('c2700000-0000-4000-8000-0000000000a2'), NULL, 'a hidden season has no public rules');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

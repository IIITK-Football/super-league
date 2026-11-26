BEGIN;
SELECT plan(16);

INSERT INTO auth.users (id, aud, role, email)
VALUES ('c2600000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'division-life@iiitkottayam.ac.in');
INSERT INTO public.user_roles (user_id, role)
VALUES ('c2600000-0000-4000-8000-000000000001', 'dictator');
SELECT set_config('request.jwt.claim.sub', 'c2600000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok($$SELECT public.create_division('{"slug":"life-test","name":"Lifecycle"}')$$, 'a dictator creates a division');
SELECT is((SELECT visibility FROM divisions WHERE slug = 'life-test'), 'hidden', 'division is initially hidden');
SELECT lives_ok($$SELECT public.create_season((SELECT id FROM divisions WHERE slug = 'life-test'), 'first', 'First', NULL, NULL, 'league')$$,
  'season creation writes the default sections');
SELECT is((SELECT visibility FROM seasons WHERE slug = 'first'), 'hidden', 'season is initially hidden');
SELECT is((SELECT count(*) FROM season_sections WHERE season_id = (SELECT id FROM seasons WHERE slug = 'first')),
  (SELECT count(*) FROM section_types), 'every default section was created');
SELECT throws_ok($$SELECT public.set_current_season((SELECT id FROM seasons WHERE slug = 'first'))$$,
  '22023', NULL, 'a hidden season cannot be current');
SELECT public.update_season((SELECT id FROM seasons WHERE slug = 'first'), '{"visibility":"public"}');
SELECT public.set_current_season((SELECT id FROM seasons WHERE slug = 'first'));
SELECT ok((SELECT is_current FROM seasons WHERE slug = 'first'), 'published season can become current');
SELECT public.update_season((SELECT id FROM seasons WHERE slug = 'first'), '{"visibility":"hidden"}');
SELECT ok((SELECT NOT is_current FROM seasons WHERE slug = 'first'), 'hiding clears current in the same write');
SELECT public.update_season((SELECT id FROM seasons WHERE slug = 'first'), '{"visibility":"public"}');
SELECT public.set_current_season((SELECT id FROM seasons WHERE slug = 'first'));
SELECT public.update_season((SELECT id FROM seasons WHERE slug = 'first'), '{"archived":true}');
SELECT ok((SELECT NOT is_current AND archived_at IS NOT NULL FROM seasons WHERE slug = 'first'), 'archiving clears current');
SELECT public.update_season((SELECT id FROM seasons WHERE slug = 'first'), '{"archived":false}');
SELECT ok((SELECT NOT is_current AND archived_at IS NULL AND visibility = 'hidden' FROM seasons WHERE slug = 'first'),
  'restoring returns to hidden');
SELECT throws_ok($$UPDATE seasons SET is_current = true WHERE slug = 'first'$$, '23514', NULL, 'constraint forbids a hidden current season');
SELECT throws_ok($$SELECT public.reorder_seasons((SELECT id FROM divisions WHERE slug = 'life-test'), '{}'::uuid[])$$,
  '22023', NULL, 'ordering requires every season');
SELECT public.reorder_seasons((SELECT id FROM divisions WHERE slug = 'life-test'), ARRAY[(SELECT id FROM seasons WHERE slug = 'first')]);

SELECT public.save_season_sections((SELECT id FROM seasons WHERE slug = 'first'),
  (SELECT jsonb_agg(jsonb_build_object('section_key', key, 'enabled', key <> 'fixtures',
    'nav_visible', false, 'label', CASE WHEN key = 'fixtures' THEN 'Calendar' ELSE NULL END) ORDER BY key)
  FROM section_types));
SELECT is((SELECT label FROM season_sections WHERE section_key = 'fixtures' AND season_id = (SELECT id FROM seasons WHERE slug = 'first')),
  'Calendar', 'a section label is saved');
SELECT is((SELECT public.section_flags(s)->>'fixtures' FROM seasons s WHERE slug = 'first'), 'false', 'effective flags include overrides');
RESET ROLE;

-- Force a failure after the season row is inserted.
CREATE FUNCTION pg_temp.reject_lifecycle_sections() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'induced section failure' USING ERRCODE = '22023';
END;
$$;
CREATE TRIGGER reject_lifecycle_sections BEFORE INSERT ON public.season_sections
  FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_lifecycle_sections();
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.create_season((SELECT id FROM divisions WHERE slug = 'life-test'), 'rollback', 'Rollback', NULL, NULL, 'league')$$,
  '22023', 'induced section failure', 'a section failure aborts creation');
SELECT is((SELECT count(*) FROM seasons WHERE slug = 'rollback'), 0::bigint, 'the season was rolled back');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;

BEGIN;
SELECT plan(7);
INSERT INTO auth.users (id, aud, role, email) VALUES
  ('c2800000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'featured-dictator@iiitkottayam.ac.in'),
  ('c2800000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'featured-editor@iiitkottayam.ac.in');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c2800000-0000-4000-8000-000000000001', 'dictator'),
  ('c2800000-0000-4000-8000-000000000002', 'editor');
INSERT INTO public.divisions (id, slug, name, visibility) VALUES
  ('c2800000-0000-4000-8000-00000000000a', 'featured-public', 'Public', 'public'),
  ('c2800000-0000-4000-8000-00000000000b', 'featured-hidden', 'Hidden', 'hidden');
SELECT set_config('request.jwt.claim.sub', 'c2800000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.set_featured_division('c2800000-0000-4000-8000-00000000000a')$$, 'dictator can select current division');
SELECT is((SELECT count(*) FROM divisions WHERE is_featured), 1::bigint, 'only one division is current');
SELECT throws_ok($$SELECT public.set_featured_division('c2800000-0000-4000-8000-00000000000b')$$, '22023', NULL, 'hidden division cannot be selected');
SELECT ok((SELECT is_featured FROM divisions WHERE id = 'c2800000-0000-4000-8000-00000000000a'), 'failed selection keeps current division');
SELECT lives_ok($$SELECT public.update_division('c2800000-0000-4000-8000-00000000000a', '{"landing_video_key":"new-video"}')$$, 'video key can be configured');
SELECT set_config('request.jwt.claim.sub', 'c2800000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$SELECT public.set_featured_division('c2800000-0000-4000-8000-00000000000a')$$, '42501', NULL, 'editor cannot select current division');
RESET ROLE;
UPDATE divisions SET visibility = 'hidden' WHERE id = 'c2800000-0000-4000-8000-00000000000a';
SELECT ok(NOT (SELECT is_featured FROM divisions WHERE id = 'c2800000-0000-4000-8000-00000000000a'), 'hiding current division clears selection');
SELECT * FROM finish();
ROLLBACK;

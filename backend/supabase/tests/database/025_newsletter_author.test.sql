-- Group: database. An article's byline is public (and audited), so it is never an email address: the database
-- refuses one, and no stored article carries one. Rolled back.
BEGIN;
SELECT plan(3);
SELECT has_check('public', 'newsletter', 'articles have a byline check');
SELECT throws_ok($$INSERT INTO public.newsletter (title, summary, author, content, category, date)
                  VALUES ('t', 's', 'someone@iiitkottayam.ac.in', '[]', 'x', now())$$,
  '23514', NULL, 'an email address is refused as a byline');
SELECT is((SELECT count(*)::int FROM public.newsletter WHERE author LIKE '%@%'), 0, 'no stored article has an email byline');
SELECT * FROM finish();
ROLLBACK;

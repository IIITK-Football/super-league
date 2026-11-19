-- Read-only report of the player email conversion (20261130000006) and of the account matching it leaves to review.
-- Run it on a local production-shaped copy before the production rollout, or in the SQL Editor of a project after the
-- migrations. It runs in a READ ONLY transaction that is always rolled back.
--
-- Part 1 holds no email address: the outcome of every former contact email, counted. Part 2 lists the matching cases
-- (it shows the private match keys and Auth emails, like the dictator's matching preview): keep the output to
-- yourself. Nothing here links, dismisses or changes anything.
BEGIN READ ONLY;

-- 1. What happened to each former contact email (counts only).
SELECT outcome, count(*) AS players
FROM public.player_email_migration_outcomes
GROUP BY outcome
ORDER BY outcome;

-- 2. Matching cases still to review, as the dictator's "Account matching" panel shows them.
WITH keys AS (
  SELECT k.player_id, k.email, p.first_name || ' ' || p.last_name AS player, count(*) OVER (PARTITION BY k.email) AS sharing
  FROM public.player_link_keys k JOIN public.players p ON p.id = k.player_id
  WHERE p.user_id IS NULL
)
SELECT CASE
         WHEN k.sharing > 1 THEN 'duplicate'
         WHEN u.id IS NULL THEN 'no_account'
         WHEN u.email_confirmed_at IS NULL THEN 'waiting_verification'
         WHEN EXISTS (SELECT 1 FROM public.players o WHERE o.user_id = u.id) THEN 'conflict'
         ELSE 'ready'
       END AS status,
       k.player_id, k.player, k.email
FROM keys k
LEFT JOIN auth.users u ON lower(btrim(u.email::text)) = k.email
ORDER BY status, k.player;

ROLLBACK;

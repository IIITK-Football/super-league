-- Read-only review: players whose dictator-entered contact email matches a verified account, as a starting file for the
-- account-link import (Teams & Rosters > Import account links), plus contact emails shared by several players, which
-- the import never resolves on its own. Nothing is linked here and nothing is matched by name.
--
-- Run it on a local production-shaped copy or in the SQL Editor of the project you are reviewing. It runs in a READ
-- ONLY transaction that is always rolled back. The output contains personal data (emails): keep it to yourself, check
-- every row, and paste only the rows you have confirmed into the import, which previews them again before linking.
BEGIN READ ONLY;

-- 1. Candidate links: player_id,email lines for the import. already_linked / account_linked_elsewhere explain rows the
--    import would skip or refuse.
SELECT p.id AS player_id,
       lower(btrim(d.email)) AS email,
       p.first_name || ' ' || p.last_name AS player,
       CASE
         WHEN p.user_id = u.id THEN 'already_linked'
         WHEN p.user_id IS NOT NULL THEN 'player_linked_elsewhere'
         WHEN EXISTS (SELECT 1 FROM public.players o WHERE o.user_id = u.id) THEN 'account_linked_elsewhere'
         ELSE 'candidate'
       END AS status
FROM public.players p
JOIN public.player_private_details d ON d.player_id = p.id
JOIN auth.users u ON lower(u.email::text) = lower(btrim(d.email)) AND u.email_confirmed_at IS NOT NULL
ORDER BY status, player;

-- 2. Contact emails used by more than one player: decide which player (if any) the account belongs to by hand.
SELECT lower(btrim(d.email)) AS email, count(*) AS players, string_agg(p.first_name || ' ' || p.last_name, '; ' ORDER BY p.last_name) AS names
FROM public.player_private_details d
JOIN public.players p ON p.id = d.player_id
WHERE NULLIF(btrim(d.email), '') IS NOT NULL
GROUP BY lower(btrim(d.email))
HAVING count(*) > 1
ORDER BY players DESC, email;

ROLLBACK;

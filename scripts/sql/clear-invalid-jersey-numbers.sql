-- One-time correction of legacy jersey numbers, run on a project that has NOT yet applied
-- 20261124000000_player_identity_rosters (that migration moves jersey numbers onto season roster places, which allow
-- 0-99 only and one number per team, and stops while any number breaks either rule).
--
-- Why (found in the production rehearsal, 2026-11-19):
-- * the March 2026 admin players API accepted any number: 10 players were saved with 100, 101, 102 or 600;
-- * the team registration form never checked duplicates: in 2 Freshers registrations (9 October 2026), three numbers
--   were each submitted for two different members in the same submission.
-- They are real people and are all kept. Owner decision 2026-11-19: such numbers are cleared to "not set" (for every
-- holder of a duplicate, since which one is right cannot be known); a captain or dictator enters the right ones later.
--
-- Target: public.players.jersey_number and public.team_members.jersey_number only, set to NULL where the number is
-- outside 0-99, or shared with someone else on the same team (players: same team_id; members: same registration_id).
-- Safeguards:
-- * inside the transaction the two tables are locked and the list is checked again: if any listed number changed, or a
--   new invalid number appeared, it stops with nothing changed;
-- * a row is updated only if it still holds the listed old number.
-- Running it again changes nothing (the list is empty).
--
-- How to run (owner, production SQL Editor, after the manual export, immediately before approving the production
-- database job; docs/release.md):
-- 1. Preview: run it with the COMMIT line below changed to ROLLBACK. Nothing is written; the list is shown.
-- 2. Run it as is. The result is the list of changes (record kind, id, old number, reason; no personal data). Export
--    it: it is the rollback record (set each listed id's jersey_number back to old_jersey_number).
-- It is never run by CI or by the assistant against a hosted project.
DROP TABLE IF EXISTS pg_temp._jersey_corrections;
CREATE TEMP TABLE _jersey_corrections AS
SELECT 'player'::text AS kind, p.id, p.jersey_number AS old_jersey_number,
       CASE WHEN p.jersey_number NOT BETWEEN 0 AND 99 THEN 'out of range' ELSE 'shared on the team' END AS reason
FROM public.players p
WHERE p.jersey_number IS NOT NULL
  AND (p.jersey_number NOT BETWEEN 0 AND 99
       OR (p.team_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.players o
                                             WHERE o.team_id = p.team_id AND o.jersey_number = p.jersey_number AND o.id <> p.id)))
UNION ALL
SELECT 'team member', m.id, m.jersey_number,
       CASE WHEN m.jersey_number NOT BETWEEN 0 AND 99 THEN 'out of range' ELSE 'shared on the team' END
FROM public.team_members m
WHERE m.jersey_number IS NOT NULL
  AND (m.jersey_number NOT BETWEEN 0 AND 99
       OR EXISTS (SELECT 1 FROM public.team_members o
                  WHERE o.registration_id = m.registration_id AND o.jersey_number = m.jersey_number AND o.id <> m.id));

BEGIN;
LOCK TABLE public.players, public.team_members IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  v_changed integer;
  v_new integer;
BEGIN
  SELECT count(*) INTO v_changed FROM _jersey_corrections c
  WHERE (c.kind = 'player' AND NOT EXISTS (SELECT 1 FROM public.players p WHERE p.id = c.id AND p.jersey_number = c.old_jersey_number))
     OR (c.kind = 'team member' AND NOT EXISTS (SELECT 1 FROM public.team_members m WHERE m.id = c.id AND m.jersey_number = c.old_jersey_number));
  SELECT count(*) INTO v_new FROM (
    SELECT p.id FROM public.players p
    WHERE p.jersey_number IS NOT NULL AND (p.jersey_number NOT BETWEEN 0 AND 99
      OR (p.team_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.players o WHERE o.team_id = p.team_id AND o.jersey_number = p.jersey_number AND o.id <> p.id)))
    UNION ALL
    SELECT m.id FROM public.team_members m
    WHERE m.jersey_number IS NOT NULL AND (m.jersey_number NOT BETWEEN 0 AND 99
      OR EXISTS (SELECT 1 FROM public.team_members o WHERE o.registration_id = m.registration_id AND o.jersey_number = m.jersey_number AND o.id <> m.id))
  ) x WHERE x.id NOT IN (SELECT id FROM _jersey_corrections);
  IF v_changed > 0 OR v_new > 0 THEN
    RAISE EXCEPTION 'Jersey correction stopped: the data changed since the list was made (% listed numbers changed, % new). Nothing was changed; run it again.', v_changed, v_new;
  END IF;
  RAISE NOTICE 'Jersey numbers cleared: %', (SELECT count(*) FROM _jersey_corrections);
END;
$$;

UPDATE public.players p SET jersey_number = NULL
FROM _jersey_corrections c WHERE c.kind = 'player' AND p.id = c.id AND p.jersey_number = c.old_jersey_number;
UPDATE public.team_members m SET jersey_number = NULL
FROM _jersey_corrections c WHERE c.kind = 'team member' AND m.id = c.id AND m.jersey_number = c.old_jersey_number;

COMMIT;

SELECT kind, id, old_jersey_number, reason FROM _jersey_corrections ORDER BY kind, id;

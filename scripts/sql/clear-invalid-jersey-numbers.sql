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
-- What it does, in one transaction: sets jersey_number to NULL on players and legacy team members whose number is
-- outside 0-99, or shared with someone else on the same team (players: same team; members: same registration), and
-- lists each change (record kind, id, old number; no personal data): export that result. Nothing else changes.
-- Running it again changes nothing.
--
-- Production: the owner runs this in the SQL Editor after the manual export and immediately before approving the
-- production database job (docs/release.md). It is never run by CI or by the assistant against a hosted project.
BEGIN;

CREATE TEMP TABLE _jersey_corrections ON COMMIT DROP AS
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

UPDATE public.players p SET jersey_number = NULL
FROM _jersey_corrections c WHERE c.kind = 'player' AND p.id = c.id;
UPDATE public.team_members m SET jersey_number = NULL
FROM _jersey_corrections c WHERE c.kind = 'team member' AND m.id = c.id;

DO $$ BEGIN RAISE NOTICE 'Jersey numbers cleared: %', (SELECT count(*) FROM _jersey_corrections); END $$;

SELECT kind, id, old_jersey_number, reason FROM _jersey_corrections ORDER BY kind, id;

COMMIT;

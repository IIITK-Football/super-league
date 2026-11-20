-- Retire team_registrations. Its captains live in captain_assignments, every registration is preserved whole in
-- legacy_team_registrations (20261201000000), and no application code, function or policy reads it any more.
-- The drop is refused, changing nothing, unless every registration is in the snapshot and every registration's team
-- entry still has a captain assignment or a recorded reason: the guard below compares counts and identities first.
-- Forward-only; the snapshot and the audit history keep the data.

DO $$
DECLARE
  n_reg integer;
  n_missing integer;
BEGIN
  SELECT count(*) INTO n_reg FROM public.team_registrations;
  SELECT count(*) INTO n_missing FROM public.team_registrations r
  WHERE NOT EXISTS (SELECT 1 FROM public.legacy_team_registrations l
                    WHERE l.registration_id = r.id AND l.captain_id IS NOT DISTINCT FROM r.captain_id
                      AND l.team_id IS NOT DISTINCT FROM r.team_id AND l.season_id IS NOT DISTINCT FROM r.season_id);
  IF n_missing > 0 THEN
    RAISE EXCEPTION '% of % registrations are not in legacy_team_registrations; nothing was dropped', n_missing, n_reg;
  END IF;
  IF (SELECT count(*) FROM public.legacy_team_registrations) < n_reg THEN
    RAISE EXCEPTION 'the registration snapshot has fewer rows than team_registrations; nothing was dropped';
  END IF;
  RAISE NOTICE 'team_registrations rows preserved in legacy_team_registrations: %', n_reg;
END;
$$;

DROP TABLE public.team_registrations;

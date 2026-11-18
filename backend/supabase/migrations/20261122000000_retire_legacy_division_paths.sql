-- Retire the legacy division-string paths (contract step, owner instruction 2026-11-19).
--
-- Every reader and writer now uses divisions, seasons (matches.season_id, team_registrations.season_id,
-- team_entries), division_flairs and season_player_stats. This migration removes what only served the old model:
--   * the division columns on teams, matches and team_registrations, with their check constraints;
--   * user_profiles.mens_team_flair / womens_team_flair (copied to division_flairs by 20261121000000);
--   * the compatibility triggers and functions, the backfill and drift report, and legacy_division_map;
--   * the views top_scorers, league_standings and league_schedule;
--   * the unused polls feature: polls, poll_options and increment_vote (empty in production, no frontend caller).
--
-- It refuses, changing nothing, unless every record survives:
--   * every match and registration is attached to a season, and the drift report is empty;
--   * every team with a legacy division has a team entry in that division;
--   * every old flair value exists in division_flairs;
--   * polls hold nothing but the synthetic seed fixtures (deterministic ids), which are removed first.
-- Forward-only. Data is never deleted except those synthetic poll fixtures.

-- legacy-contract-guard:start
DO $$
DECLARE
  v_drift integer;
  v_unattached integer;
  v_flairs integer;
  v_polls integer;
  v_options integer;
BEGIN
  SELECT count(*) INTO v_drift FROM public.division_model_drift();
  IF v_drift > 0 THEN
    RAISE EXCEPTION 'Legacy contract stopped: % row(s) disagree between division and season (SELECT * FROM public.division_model_drift()). Nothing was changed.', v_drift;
  END IF;

  SELECT (SELECT count(*) FROM public.matches WHERE season_id IS NULL)
       + (SELECT count(*) FROM public.team_registrations WHERE season_id IS NULL)
    INTO v_unattached;
  IF v_unattached > 0 THEN
    RAISE EXCEPTION 'Legacy contract stopped: % match(es) or registration(s) have no season. Nothing was changed.', v_unattached;
  END IF;

  SELECT count(*) INTO v_flairs
  FROM public.user_profiles p
  CROSS JOIN LATERAL (VALUES ('mens', p.mens_team_flair), ('womens', p.womens_team_flair)) AS f(legacy_key, team_name)
  LEFT JOIN public.legacy_division_map m ON m.legacy_key = f.legacy_key
  LEFT JOIN public.division_flairs df ON df.user_id = p.id AND df.division_id = m.division_id
  WHERE f.team_name IS NOT NULL AND btrim(f.team_name) <> '' AND df.user_id IS NULL;
  IF v_flairs > 0 THEN
    RAISE EXCEPTION 'Legacy contract stopped: % flair value(s) are not in division_flairs. Nothing was changed.', v_flairs;
  END IF;

  -- The seed's synthetic polls are the only expected rows; production has none.
  DELETE FROM public.poll_options WHERE id IN (
    SELECT md5('mega-poll-option:' || p || ':' || o)::uuid FROM generate_series(1, 6) p, generate_series(1, 4) o);
  DELETE FROM public.polls WHERE id IN (SELECT md5('mega-poll:' || p)::uuid FROM generate_series(1, 6) p);
  SELECT count(*) INTO v_polls FROM public.polls;
  SELECT count(*) INTO v_options FROM public.poll_options;
  IF v_polls > 0 OR v_options > 0 THEN
    RAISE EXCEPTION 'Legacy contract stopped: % poll(s) and % poll option(s) hold real data. Nothing was changed.', v_polls, v_options;
  END IF;
END $$;
-- legacy-contract-guard:end

-- Compatibility machinery
DROP TRIGGER matches_sync_division_season ON public.matches;
DROP TRIGGER team_registrations_sync_division_season ON public.team_registrations;
DROP TRIGGER teams_enter_legacy_season ON public.teams;
DROP FUNCTION public.sync_legacy_division_season();
DROP FUNCTION public.enter_team_in_legacy_season();
DROP FUNCTION public.backfill_legacy_divisions();
DROP FUNCTION public.division_model_drift();
DROP FUNCTION public.legacy_current_season(text);
DROP FUNCTION public.legacy_key_for_season(uuid);
DROP TABLE public.legacy_division_map;

-- Division-string views
DROP VIEW public.top_scorers;
DROP VIEW public.league_standings;
DROP VIEW public.league_schedule;

-- Legacy columns (their check constraints go with them)
ALTER TABLE public.teams DROP COLUMN division;
ALTER TABLE public.matches DROP COLUMN division;
ALTER TABLE public.team_registrations DROP COLUMN division;
ALTER TABLE public.user_profiles DROP COLUMN mens_team_flair, DROP COLUMN womens_team_flair;

-- Every match and registration now belongs to a season.
ALTER TABLE public.matches ALTER COLUMN season_id SET NOT NULL;
ALTER TABLE public.team_registrations ALTER COLUMN season_id SET NOT NULL;

-- The unused polls feature
DROP FUNCTION public.increment_vote(uuid);
DROP TABLE public.poll_options;
DROP TABLE public.polls;

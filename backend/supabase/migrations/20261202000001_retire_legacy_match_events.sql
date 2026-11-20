-- Retire the legacy match event stores: the goals table, the matches.scorers / assists / own_goals JSON columns and the
-- legacy_player_assist_counts snapshot. Every reader and writer now uses match_events (20261202000000), whose
-- migration report keeps the findings. The drop is refused, changing nothing, unless every goal id has its event, every
-- match's JSON totals are covered by events, every played match's cached score equals its events, and every snapshot
-- row is in the report. Forward-only; the audit history keeps the earlier changes.

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM public.goals g WHERE NOT EXISTS (SELECT 1 FROM public.match_events e WHERE e.id = g.id);
  IF n > 0 THEN
    RAISE EXCEPTION '% goal row(s) have no match event; nothing was dropped', n;
  END IF;

  -- JSON totals covered by events, per match and kind (counted by length, so a repeated player counts each time).
  SELECT count(*) INTO n FROM public.matches m
  WHERE (CASE WHEN jsonb_typeof(m.scorers) = 'array' THEN jsonb_array_length(m.scorers) ELSE 0 END)
          > (SELECT count(*) FROM public.match_events e WHERE e.match_id = m.id AND e.kind = 'goal' AND e.player_id IS NOT NULL)
     OR (CASE WHEN jsonb_typeof(m.own_goals) = 'array' THEN jsonb_array_length(m.own_goals) ELSE 0 END)
          > (SELECT count(*) FROM public.match_events e WHERE e.match_id = m.id AND e.kind = 'own_goal');
  IF n > 0 THEN
    RAISE EXCEPTION '% match(es) list more scorers or own goals in the JSON than their events record; nothing was dropped', n;
  END IF;

  SELECT count(*) INTO n FROM public.matches m
  WHERE m.result_kind = 'played' AND (
        COALESCE(m.home_score, 0) <> (SELECT count(*) FROM public.match_events e WHERE e.match_id = m.id AND e.voided_at IS NULL
                                       AND ((e.kind = 'goal' AND e.team_id = m.home_team_id) OR (e.kind = 'own_goal' AND e.team_id = m.away_team_id)))
     OR COALESCE(m.away_score, 0) <> (SELECT count(*) FROM public.match_events e WHERE e.match_id = m.id AND e.voided_at IS NULL
                                       AND ((e.kind = 'goal' AND e.team_id = m.away_team_id) OR (e.kind = 'own_goal' AND e.team_id = m.home_team_id))));
  IF n > 0 THEN
    RAISE EXCEPTION '% played match(es) have a cached score that differs from their events; nothing was dropped', n;
  END IF;

  SELECT count(*) INTO n FROM public.legacy_player_assist_counts s
  WHERE NOT EXISTS (SELECT 1 FROM public.match_event_migration_report r
                    WHERE r.finding = 'assist_snapshot' AND r.detail ->> 'player_id' = s.player_id::text);
  IF n > 0 THEN
    RAISE EXCEPTION '% assist snapshot row(s) are not in the migration report; nothing was dropped', n;
  END IF;
  RAISE NOTICE 'legacy goal rows retired: %; assist snapshot rows retired: %', (SELECT count(*) FROM public.goals), (SELECT count(*) FROM public.legacy_player_assist_counts);
END;
$$;

DROP TABLE public.goals;
DROP TABLE public.legacy_player_assist_counts;
ALTER TABLE public.matches DROP COLUMN scorers, DROP COLUMN assists, DROP COLUMN own_goals;

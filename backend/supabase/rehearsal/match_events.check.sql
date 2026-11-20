-- LOCAL rehearsal assertions after both match-event migrations. Fails loudly; prints counts only.
DO $$
DECLARE
  n integer; before_pts record; after_pts record;
BEGIN
  SELECT count(*) INTO n FROM public.rehearsal_before b JOIN public.matches m ON m.id = b.match_id
   WHERE m.home_score IS DISTINCT FROM b.home_score OR m.away_score IS DISTINCT FROM b.away_score;
  IF n > 0 THEN RAISE EXCEPTION '% match score(s) changed', n; END IF;

  SELECT count(*) INTO n FROM public.rehearsal_before b
   WHERE (SELECT count(*) FROM public.match_events e WHERE e.match_id = b.match_id AND e.voided_at IS NULL) <
         (SELECT count(*) FILTER (WHERE true) FROM public.match_events e WHERE false) + b.goal_rows;
  IF n > 0 THEN RAISE EXCEPTION '% match(es) have fewer events than goal rows', n; END IF;

  SELECT count(*) INTO n FROM public.matches m
   WHERE m.home_score + m.away_score <> (SELECT count(*) FROM public.match_events e WHERE e.match_id = m.id AND e.voided_at IS NULL AND e.kind IN ('goal', 'own_goal'));
  IF n > 0 THEN RAISE EXCEPTION '% match score(s) are not the number of goal events', n; END IF;

  SELECT total, graded INTO before_pts FROM public.rehearsal_before_points;
  SELECT COALESCE(sum(points_awarded), 0) AS total, count(*) FILTER (WHERE status = 'graded') AS graded INTO after_pts FROM public.predictions;
  IF before_pts.total <> after_pts.total OR before_pts.graded <> after_pts.graded THEN RAISE EXCEPTION 'prediction points or graded count changed'; END IF;

  SELECT count(*) INTO n FROM public.predictions p JOIN public.matches m ON m.id = p.match_id WHERE p.status = 'graded' AND p.graded_events_version IS DISTINCT FROM m.events_version;
  IF n > 0 THEN RAISE EXCEPTION '% graded prediction(s) flagged as needing regrade', n; END IF;

  FOR n IN SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM public.match_event_migration_report WHERE finding = 'assist_dropped') LOOP RAISE EXCEPTION 'expected assist_dropped findings'; END LOOP;
  FOR n IN SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM public.match_event_migration_report WHERE finding = 'unattributed_surplus') LOOP RAISE EXCEPTION 'expected unattributed_surplus findings'; END LOOP;
  FOR n IN SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM public.match_event_migration_report WHERE finding = 'walkover_candidate') LOOP RAISE EXCEPTION 'expected walkover_candidate findings'; END LOOP;
  FOR n IN SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM public.match_event_migration_report WHERE finding = 'unparsed_minute') LOOP RAISE EXCEPTION 'expected unparsed_minute findings'; END LOOP;

  IF to_regclass('public.goals') IS NOT NULL THEN RAISE EXCEPTION 'goals table should be retired'; END IF;
END;
$$;
SELECT 'events' AS item, count(*) AS n FROM public.match_events
UNION ALL SELECT 'events from migration', count(*) FROM public.match_events WHERE source = 'migration'
UNION ALL SELECT 'unattributed goals', count(*) FROM public.match_events WHERE kind = 'goal' AND player_id IS NULL
UNION ALL SELECT 'report: ' || finding, count(*) FROM public.match_event_migration_report GROUP BY finding
UNION ALL SELECT 'prediction points sum (unchanged)', COALESCE(sum(points_awarded), 0) FROM public.predictions
ORDER BY 1;

-- Migration rehearsal assertions (run by scripts/rehearse-rosters.mjs after the new migrations were applied to the
-- pre-SL-021 schema, its seed and legacy_rosters_fixture.sql). Not part of the routine database group: the
-- rehearsal rebuilds the local database.
BEGIN;
SELECT plan(19);

-- Every Freshers member is accounted for ----------------------------------------------------------------------
SELECT is((SELECT count(*) FROM public.legacy_roster_map)::int, (SELECT members FROM public._rehearsal_before),
  'every team member is in the mapping exactly once');
SELECT is((SELECT count(*) FROM public.legacy_roster_map WHERE outcome = 'linked')::int, 16, 'the 16 seeded members link to their players');
SELECT is((SELECT count(*) FROM public.legacy_roster_map WHERE outcome = 'created')::int, 1, 'the unmatched member becomes a new player');
SELECT is((SELECT count(*) FROM public.players)::int, (SELECT players + 1 FROM public._rehearsal_before),
  'players: every existing player kept, plus the one created');
SELECT is((SELECT count(*) FROM public.roster_memberships)::int, (SELECT rostered_players + 1 FROM public._rehearsal_before),
  'memberships: one per rostered player, plus the created member''s');

-- The created member ------------------------------------------------------------------------------------------
SELECT results_eq(
  $$SELECT p.first_name::text, p.last_name::text, p.overall_rating, rm.jersey_number, rm.position, d.email, t.name::text
    FROM public.players p
    JOIN public.roster_memberships rm ON rm.player_id = p.id
    JOIN public.team_entries e ON e.id = rm.team_entry_id JOIN public.teams t ON t.id = e.team_id
    JOIN public.player_private_details d ON d.player_id = p.id
    WHERE p.id = (SELECT created_member FROM public._rehearsal_ids)$$,
  $$SELECT 'Nova'::text, 'Fresher'::text, 61, 42, 'ST'::text, 'Nova.Fresher@iiitkottayam.ac.in'::text,
           (SELECT name::text FROM public.teams WHERE id = md5('mega-team:freshers:EVER')::uuid)$$,
  'the created player keeps the member''s id, card, roster place on its registration''s team, and email');

-- A linked member: the team-builder values win and the replaced values are recorded ---------------------------
SELECT is((SELECT overall_rating FROM public.players WHERE id = (SELECT linked_player FROM public._rehearsal_ids)),
          (SELECT linked_member_rating FROM public._rehearsal_before), 'the linked player''s rating is the team builder''s');
SELECT is((SELECT (overwritten -> 'overall_rating' ->> 'from')::int FROM public.legacy_roster_map
           WHERE team_member_id = (SELECT linked_member FROM public._rehearsal_ids)),
          (SELECT linked_player_rating FROM public._rehearsal_before), 'the replaced rating is recorded');
SELECT is((SELECT player_id FROM public.legacy_roster_map WHERE team_member_id = (SELECT linked_member FROM public._rehearsal_ids)),
          (SELECT linked_player FROM public._rehearsal_ids), 'the member maps to the existing player');

-- References: linked ids rewritten, created ids kept, nothing added or lost -----------------------------------
SELECT ok(NOT (SELECT scorers::text || assists::text FROM public.matches WHERE id = (SELECT match_id FROM public._rehearsal_ids))
              LIKE '%' || (SELECT linked_member::text FROM public._rehearsal_ids) || '%',
  'no match JSON names the linked member any more');
SELECT ok((SELECT scorers @> jsonb_build_array((SELECT linked_player::text FROM public._rehearsal_ids))
                  AND scorers @> jsonb_build_array(jsonb_build_object('player_id', (SELECT linked_player::text FROM public._rehearsal_ids), 'minute', '5'))
                  AND scorers @> jsonb_build_array((SELECT created_member::text FROM public._rehearsal_ids))
           FROM public.matches WHERE id = (SELECT match_id FROM public._rehearsal_ids)),
  'string and object references now name the player; the created member''s id is unchanged');
SELECT is((SELECT predicted_scorers FROM public.predictions WHERE id = (SELECT prediction_id FROM public._rehearsal_ids)),
          jsonb_build_array((SELECT linked_player::text FROM public._rehearsal_ids), (SELECT created_member::text FROM public._rehearsal_ids)),
  'the prediction names the player (rewritten) and the created member (kept)');
SELECT is((SELECT count(*) FROM public.goals)::int, (SELECT goals FROM public._rehearsal_before), 'no goal was added or lost');
SELECT is((SELECT COALESCE(sum(points_awarded), 0) FROM public.predictions)::int, (SELECT points FROM public._rehearsal_before),
  'awarded prediction points are unchanged');

-- The retired counter is snapshotted, not migrated ------------------------------------------------------------
SELECT is((SELECT count(*) FROM public.legacy_player_assist_counts)::int, (SELECT count(*) FROM public.players)::int,
  'one counter snapshot per player');
SELECT is((SELECT counter_value FROM public.legacy_player_assist_counts WHERE player_id = (SELECT linked_player FROM public._rehearsal_ids)),
          (SELECT linked_player_counter FROM public._rehearsal_before), 'the counter value is kept in the snapshot');

-- Season statistics still read correctly ------------------------------------------------------------------------
SELECT is((SELECT goals FROM public.season_player_stats WHERE player_id = (SELECT created_member FROM public._rehearsal_ids)), 1,
  'the created member''s goal, recorded only in the match JSON, counts for the new player');
SELECT ok((SELECT bool_and(sps.club IS NOT NULL) FROM public.season_player_stats sps), 'every season line has a club');
SELECT is((SELECT count(*) FROM public.roster_memberships rm GROUP BY rm.team_entry_id, rm.jersey_number HAVING count(*) > 1 AND rm.jersey_number IS NOT NULL LIMIT 1)::int,
          NULL, 'no jersey number repeats within a team entry');

SELECT * FROM finish();
ROLLBACK;

-- Retire the team-bound roster (contract step of 20261124000000_player_identity_rosters.sql).
--
-- Every reader and writer now uses player identities and season roster memberships, so the legacy paths go:
--   * public.team_members (the Freshers registration roster; each member is mapped in legacy_roster_map);
--   * players.team_id, players.team_entry_id, players.position, players.jersey_number (now a roster place) and
--     unique_team_jersey (jersey numbers are unique per team entry);
--   * players.assists, the cross-season counter (snapshotted in legacy_player_assist_counts; season statistics come
--     from match events);
--   * both overloads of captain_update_team_member (replaced by captain_update_roster_player).
-- team_registrations stays: it is the captain assignment until the role work replaces it.
-- Guards stop the migration, with nothing changed, unless every record is kept. Forward-only.

-- roster-contract-guard:start
DO $$
DECLARE
  v_list text;
BEGIN
  SELECT string_agg(m.id::text, ', ') INTO v_list
  FROM public.team_members m WHERE NOT EXISTS (SELECT 1 FROM public.legacy_roster_map lm WHERE lm.team_member_id = m.id);
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'Roster retirement stopped: team member(s) not mapped to a player: %. Nothing was changed.', v_list;
  END IF;

  SELECT string_agg(p.id::text, ', ') INTO v_list
  FROM public.players p
  WHERE p.team_entry_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.roster_memberships rm WHERE rm.player_id = p.id AND rm.team_entry_id = p.team_entry_id);
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'Roster retirement stopped: player(s) without their season roster place: %. Nothing was changed.', v_list;
  END IF;

  SELECT string_agg(p.id::text, ', ') INTO v_list
  FROM public.players p
  WHERE NOT EXISTS (SELECT 1 FROM public.legacy_player_assist_counts c WHERE c.player_id = p.id AND c.counter_value = COALESCE(p.assists, 0))
    AND COALESCE(p.assists, 0) <> 0;
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'Roster retirement stopped: the assists counter of player(s) % is not in the snapshot. Nothing was changed.', v_list;
  END IF;

  SELECT string_agg(DISTINCT lm.team_member_id::text, ', ') INTO v_list
  FROM public.legacy_roster_map lm
  WHERE lm.outcome = 'linked' AND (
    EXISTS (SELECT 1 FROM public.matches m
            WHERE (COALESCE(m.scorers, '[]'::jsonb) || COALESCE(m.assists, '[]'::jsonb) || COALESCE(m.own_goals, '[]'::jsonb))::text
                  LIKE '%' || lm.team_member_id::text || '%')
    OR EXISTS (SELECT 1 FROM public.predictions p
               WHERE (COALESCE(p.predicted_scorers, '[]'::jsonb) || COALESCE(p.predicted_assists, '[]'::jsonb))::text
                     LIKE '%' || lm.team_member_id::text || '%'));
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'Roster retirement stopped: match or prediction entries still name linked team member(s) %. Nothing was changed.', v_list;
  END IF;
END $$;
-- roster-contract-guard:end

DROP FUNCTION public.captain_update_team_member(uuid, text, integer, integer, jsonb, text, text);
DROP FUNCTION public.captain_update_team_member(uuid, text, integer, integer, jsonb);

DROP TABLE public.team_members;

ALTER TABLE public.players DROP CONSTRAINT unique_team_jersey;
ALTER TABLE public.players
  DROP COLUMN team_id,
  DROP COLUMN team_entry_id,
  DROP COLUMN position,
  DROP COLUMN jersey_number,
  DROP COLUMN assists;

COMMENT ON TABLE public.players IS 'A reusable player identity: the FUT card (name, portrait, overall rating, attributes and play styles). Season roster places are public.roster_memberships; goals and assists are derived from match events (public.season_player_stats).';

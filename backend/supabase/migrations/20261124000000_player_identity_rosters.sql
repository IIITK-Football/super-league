-- Player identity and season roster memberships (expand step; the contract step is 20261125000000).
--
-- * public.players becomes the reusable player identity and keeps its ids (goals, match JSON, predictions and links
--   stay valid). The identity carries the FUT card: name, portrait, overall rating, attributes and play styles.
-- * public.roster_memberships places an identity on a team entry for one season, with that season's jersey and
--   position. One team per player per season; a jersey number is unique within a team entry.
-- * public.player_private_details holds a player's contact email (dictators only).
-- * Freshers registration rosters (public.team_members) are mapped onto identities (owner decisions 2026-11-18):
--     exactly one same-team, same-season player with the same normalized name -> linked to that player, and the
--       team-builder values win where they are set (every overwritten value is recorded in legacy_roster_map);
--     no such player -> a new identity that reuses the member's id, so no reference to it changes;
--     several candidates, or several members on one player -> the migration stops and lists them.
--   References to a linked member's id in match JSON and predictions are rewritten to the player's id.
-- * Goals and assists are season facts derived from match events, never stored on the identity or the membership.
--   The cross-season counter players.assists is snapshotted into legacy_player_assist_counts (for the match-event
--   work to reconcile) and dropped by the contract migration.
-- * goals.player_id no longer cascades: deleting a player who scored is refused instead of erasing goals.
-- * players are written by dictators only (captains use captain_update_roster_player, limited to the SL-003 allow-list).
-- Guards stop the migration, with nothing changed, unless every record is kept. Forward-only.

-- Preconditions ---------------------------------------------------------------------------------------------------
-- roster-guard:start
DO $$
DECLARE
  v_count integer;
  v_list text;
BEGIN
  SELECT count(*), string_agg(DISTINCT r.id::text, ', ') INTO v_count, v_list
  FROM public.team_members m JOIN public.team_registrations r ON r.id = m.registration_id
  WHERE r.team_id IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Roster migration stopped: % team member(s) belong to a registration without a team (registrations: %). Attach each registration to a team first. Nothing was changed.', v_count, v_list;
  END IF;

  SELECT count(*), string_agg(p.id::text, ', ') INTO v_count, v_list
  FROM public.players p WHERE p.jersey_number IS NOT NULL AND p.jersey_number NOT BETWEEN 0 AND 99;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Roster migration stopped: % player(s) have a jersey number outside 0-99 (%). Nothing was changed.', v_count, v_list;
  END IF;

  SELECT count(*), string_agg(m.id::text, ', ') INTO v_count, v_list
  FROM public.team_members m WHERE m.jersey_number IS NOT NULL AND m.jersey_number NOT BETWEEN 0 AND 99;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Roster migration stopped: % team member(s) have a jersey number outside 0-99 (%). Nothing was changed.', v_count, v_list;
  END IF;
END $$;
-- roster-guard:end

-- Tables ----------------------------------------------------------------------------------------------------------

ALTER TABLE public.team_entries ADD CONSTRAINT team_entries_id_season_key UNIQUE (id, season_id);

CREATE TABLE public.roster_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE RESTRICT,
  team_entry_id uuid NOT NULL,
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE RESTRICT,
  jersey_number integer CONSTRAINT roster_memberships_jersey_range CHECK (jersey_number BETWEEN 0 AND 99),
  position text CONSTRAINT roster_memberships_position_length CHECK (position IS NULL OR char_length(btrim(position)) BETWEEN 1 AND 50),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roster_memberships_entry_fkey FOREIGN KEY (team_entry_id, season_id)
    REFERENCES public.team_entries (id, season_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT roster_memberships_player_season_key UNIQUE (player_id, season_id),
  CONSTRAINT roster_memberships_entry_jersey_key UNIQUE (team_entry_id, jersey_number)
);
CREATE INDEX roster_memberships_season_id_idx ON public.roster_memberships (season_id);
COMMENT ON TABLE public.roster_memberships IS 'A player identity on a team entry (a team in one season), with that season''s jersey number and position. Holds no statistics: goals and assists are derived from match events.';
CREATE TRIGGER roster_memberships_updated_at BEFORE UPDATE ON public.roster_memberships FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE public.player_private_details (
  player_id uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  email text CONSTRAINT player_private_details_email_length CHECK (email IS NULL OR char_length(email) BETWEEN 3 AND 320),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.player_private_details IS 'Protected player contact data. Dictators only; never part of a public read.';
CREATE TRIGGER player_private_details_updated_at BEFORE UPDATE ON public.player_private_details FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE public.legacy_roster_map (
  team_member_id uuid PRIMARY KEY,
  registration_id uuid NOT NULL,
  player_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
  outcome text NOT NULL CONSTRAINT legacy_roster_map_outcome CHECK (outcome IN ('linked', 'created')),
  overwritten jsonb NOT NULL DEFAULT '{}'::jsonb,
  mapped_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.legacy_roster_map IS 'How each Freshers team member became a player identity (linked to an existing player or created with the member''s id), and every player value the team-builder value replaced.';

CREATE TABLE public.legacy_player_assist_counts (
  player_id uuid PRIMARY KEY,
  counter_value integer NOT NULL,
  event_assists_at_capture integer NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.legacy_player_assist_counts IS 'Snapshot of the retired cross-season counter players.assists, next to the assists the goals recorded at capture time. Reconciled and dropped by the match-event work.';

-- Season rosters of the existing players --------------------------------------------------------------------------

INSERT INTO public.roster_memberships (player_id, team_entry_id, season_id, jersey_number, position)
SELECT p.id, e.id, e.season_id, p.jersey_number, NULLIF(btrim(p.position), '')
FROM public.players p
JOIN public.team_entries e ON e.id = p.team_entry_id;

-- Freshers registration rosters -----------------------------------------------------------------------------------

-- Each registration's team plays the registration's season.
INSERT INTO public.team_entries (team_id, season_id)
SELECT DISTINCT r.team_id, r.season_id
FROM public.team_registrations r
WHERE r.team_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.team_members m WHERE m.registration_id = r.id)
ON CONFLICT (team_id, season_id) DO NOTHING;

CREATE TEMP TABLE _sl_members AS
SELECT m.id AS member_id,
       m.registration_id,
       e.id AS entry_id,
       e.season_id,
       lower(regexp_replace(btrim(COALESCE(NULLIF(btrim(concat_ws(' ', m.first_name, m.last_name)), ''), m.name)), '\s+', ' ', 'g')) AS norm,
       btrim(COALESCE(NULLIF(btrim(concat_ws(' ', m.first_name, m.last_name)), ''), m.name)) AS full_name,
       NULLIF(btrim(m.first_name), '') AS first_name,
       NULLIF(btrim(m.last_name), '') AS last_name,
       m.jersey_number,
       NULLIF(btrim(m.position), '') AS position,
       m.image_url,
       m.overall_rating,
       m.attributes,
       NULLIF(btrim(m.email), '') AS email
FROM public.team_members m
JOIN public.team_registrations r ON r.id = m.registration_id
JOIN public.team_entries e ON e.team_id = r.team_id AND e.season_id = r.season_id;

CREATE TEMP TABLE _sl_candidates AS
SELECT s.member_id, rm.player_id, rm.id AS membership_id
FROM _sl_members s
JOIN public.roster_memberships rm ON rm.team_entry_id = s.entry_id
JOIN public.players p ON p.id = rm.player_id
WHERE lower(regexp_replace(btrim(p.first_name::text || ' ' || p.last_name::text), '\s+', ' ', 'g')) = s.norm;

-- roster-guard:start
DO $$
DECLARE
  v_list text;
BEGIN
  SELECT string_agg(format('%s (%s)', s.full_name, s.member_id), '; ') INTO v_list
  FROM _sl_members s WHERE (SELECT count(*) FROM _sl_candidates c WHERE c.member_id = s.member_id) > 1;
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'Roster migration stopped: team member(s) match more than one player on their team: %. Resolve them by hand first. Nothing was changed.', v_list;
  END IF;

  SELECT string_agg(DISTINCT format('player %s claimed by members %s', c.player_id,
           (SELECT string_agg(c2.member_id::text, ', ') FROM _sl_candidates c2 WHERE c2.player_id = c.player_id)), '; ') INTO v_list
  FROM _sl_candidates c WHERE (SELECT count(*) FROM _sl_candidates c2 WHERE c2.player_id = c.player_id) > 1;
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'Roster migration stopped: several team members match the same player: %. Resolve them by hand first. Nothing was changed.', v_list;
  END IF;

  SELECT string_agg(format('%s (%s)', s.member_id, s.full_name), '; ') INTO v_list
  FROM _sl_members s
  WHERE NOT EXISTS (SELECT 1 FROM _sl_candidates c WHERE c.member_id = s.member_id)
    AND EXISTS (SELECT 1 FROM public.players p WHERE p.id = s.member_id);
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'Roster migration stopped: team member id(s) already used by an unrelated player: %. Nothing was changed.', v_list;
  END IF;

  -- The jersey each roster place will have after the merge must be unique within its team entry.
  SELECT string_agg(format('entry %s jersey %s', x.entry_id, x.jersey_number), '; ') INTO v_list
  FROM (
    SELECT entry_id, jersey_number FROM (
      SELECT rm.team_entry_id AS entry_id,
             COALESCE((SELECT s.jersey_number FROM _sl_candidates c JOIN _sl_members s ON s.member_id = c.member_id
                       WHERE c.membership_id = rm.id), rm.jersey_number) AS jersey_number
      FROM public.roster_memberships rm
      WHERE rm.team_entry_id IN (SELECT entry_id FROM _sl_members)
      UNION ALL
      SELECT s.entry_id, s.jersey_number FROM _sl_members s
      WHERE NOT EXISTS (SELECT 1 FROM _sl_candidates c WHERE c.member_id = s.member_id)
    ) j
    WHERE jersey_number IS NOT NULL
    GROUP BY entry_id, jersey_number HAVING count(*) > 1
  ) x;
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'Roster migration stopped: jersey numbers would collide on a team: %. Nothing was changed.', v_list;
  END IF;
END $$;
-- roster-guard:end

-- Linked members: the team-builder values win where they are set; the replaced values are recorded.
INSERT INTO public.legacy_roster_map (team_member_id, registration_id, player_id, outcome, overwritten)
SELECT s.member_id, s.registration_id, c.player_id, 'linked',
       jsonb_strip_nulls(jsonb_build_object(
         'overall_rating', CASE WHEN s.overall_rating IS NOT NULL AND s.overall_rating IS DISTINCT FROM p.overall_rating
                                THEN jsonb_build_object('from', p.overall_rating, 'to', s.overall_rating) END,
         'attributes', CASE WHEN s.attributes IS NOT NULL AND s.attributes <> '{}'::jsonb AND s.attributes IS DISTINCT FROM p.attributes
                            THEN jsonb_build_object('from', p.attributes, 'to', s.attributes) END,
         'image_url', CASE WHEN s.image_url IS NOT NULL AND s.image_url IS DISTINCT FROM p.image_url
                           THEN jsonb_build_object('from', p.image_url, 'to', s.image_url) END,
         'jersey_number', CASE WHEN s.jersey_number IS NOT NULL AND s.jersey_number IS DISTINCT FROM rm.jersey_number
                               THEN jsonb_build_object('from', rm.jersey_number, 'to', s.jersey_number) END,
         'position', CASE WHEN s.position IS NOT NULL AND s.position IS DISTINCT FROM rm.position
                          THEN jsonb_build_object('from', rm.position, 'to', s.position) END
       ))
FROM _sl_members s
JOIN _sl_candidates c ON c.member_id = s.member_id
JOIN public.players p ON p.id = c.player_id
JOIN public.roster_memberships rm ON rm.id = c.membership_id;

UPDATE public.players p
SET overall_rating = COALESCE(s.overall_rating, p.overall_rating),
    attributes = CASE WHEN s.attributes IS NULL OR s.attributes = '{}'::jsonb THEN p.attributes ELSE s.attributes END,
    image_url = COALESCE(s.image_url, p.image_url)
FROM _sl_candidates c JOIN _sl_members s ON s.member_id = c.member_id
WHERE p.id = c.player_id;

-- Clear the jerseys being replaced first, so swapping numbers within a team cannot trip the unique key midway.
UPDATE public.roster_memberships rm SET jersey_number = NULL
FROM _sl_candidates c JOIN _sl_members s ON s.member_id = c.member_id
WHERE rm.id = c.membership_id AND s.jersey_number IS NOT NULL;
UPDATE public.roster_memberships rm
SET jersey_number = COALESCE(s.jersey_number, rm.jersey_number),
    position = COALESCE(s.position, rm.position)
FROM _sl_candidates c JOIN _sl_members s ON s.member_id = c.member_id
WHERE rm.id = c.membership_id;

-- Unmatched members become identities with their own id.
INSERT INTO public.players (id, first_name, last_name, image_url, overall_rating, attributes)
SELECT s.member_id,
       left(COALESCE(s.first_name, split_part(s.full_name, ' ', 1)), 100),
       left(COALESCE(s.last_name, CASE WHEN position(' ' IN s.full_name) > 0 THEN substr(s.full_name, position(' ' IN s.full_name) + 1) ELSE '' END), 100),
       s.image_url,
       COALESCE(s.overall_rating, 50),
       COALESCE(s.attributes, '{}'::jsonb)
FROM _sl_members s
WHERE NOT EXISTS (SELECT 1 FROM _sl_candidates c WHERE c.member_id = s.member_id);

INSERT INTO public.roster_memberships (player_id, team_entry_id, season_id, jersey_number, position)
SELECT s.member_id, s.entry_id, s.season_id, s.jersey_number, s.position
FROM _sl_members s
WHERE NOT EXISTS (SELECT 1 FROM _sl_candidates c WHERE c.member_id = s.member_id);

INSERT INTO public.legacy_roster_map (team_member_id, registration_id, player_id, outcome)
SELECT s.member_id, s.registration_id, s.member_id, 'created'
FROM _sl_members s
WHERE NOT EXISTS (SELECT 1 FROM _sl_candidates c WHERE c.member_id = s.member_id);

-- Contact emails: the member's email wins; a replaced email is recorded with the mapping.
UPDATE public.legacy_roster_map lm
SET overwritten = lm.overwritten || jsonb_build_object('email', jsonb_build_object('from', d.email, 'to', s.email))
FROM _sl_members s, public.player_private_details d
WHERE lm.team_member_id = s.member_id AND d.player_id = lm.player_id
  AND s.email IS NOT NULL AND d.email IS DISTINCT FROM s.email;
INSERT INTO public.player_private_details (player_id, email)
SELECT DISTINCT ON (lm.player_id) lm.player_id, s.email
FROM _sl_members s JOIN public.legacy_roster_map lm ON lm.team_member_id = s.member_id
WHERE s.email IS NOT NULL
ORDER BY lm.player_id, s.member_id
ON CONFLICT (player_id) DO UPDATE SET email = EXCLUDED.email;

-- A linked member's id in match JSON and predictions now names the player. Elements are id strings or
-- {"player_id": ...} objects; anything else is left as it is.
CREATE TEMP TABLE _sl_linked AS
SELECT team_member_id::text AS old_id, player_id::text AS new_id FROM public.legacy_roster_map WHERE outcome = 'linked';

CREATE FUNCTION pg_temp.sl_remap(p_arr jsonb) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_arr IS NULL OR jsonb_typeof(p_arr) <> 'array' THEN p_arr ELSE COALESCE((
    SELECT jsonb_agg(
             CASE
               WHEN jsonb_typeof(t.el) = 'string' AND l.new_id IS NOT NULL THEN to_jsonb(l.new_id)
               WHEN jsonb_typeof(t.el) = 'object' AND l.new_id IS NOT NULL THEN jsonb_set(t.el, '{player_id}', to_jsonb(l.new_id))
               ELSE t.el
             END ORDER BY t.ord)
    FROM jsonb_array_elements(p_arr) WITH ORDINALITY AS t(el, ord)
    LEFT JOIN _sl_linked l ON l.old_id = CASE jsonb_typeof(t.el) WHEN 'string' THEN t.el #>> '{}' WHEN 'object' THEN t.el ->> 'player_id' END
  ), '[]'::jsonb) END
$$;

CREATE FUNCTION pg_temp.sl_refs(p_arr jsonb) RETURNS SETOF text
LANGUAGE sql STABLE AS $$
  SELECT CASE jsonb_typeof(t.el) WHEN 'string' THEN t.el #>> '{}' WHEN 'object' THEN t.el ->> 'player_id' END
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_arr) = 'array' THEN p_arr ELSE '[]'::jsonb END) AS t(el)
$$;

CREATE TEMP TABLE _sl_before AS
SELECT
  (SELECT COALESCE(sum(jsonb_array_length(scorers)), 0) + COALESCE(sum(jsonb_array_length(assists)), 0) + COALESCE(sum(jsonb_array_length(own_goals)), 0)
   FROM public.matches WHERE jsonb_typeof(scorers) = 'array' AND jsonb_typeof(assists) = 'array' AND jsonb_typeof(own_goals) = 'array') AS match_elements,
  (SELECT COALESCE(sum(jsonb_array_length(predicted_scorers)), 0) + COALESCE(sum(jsonb_array_length(predicted_assists)), 0)
   FROM public.predictions WHERE jsonb_typeof(predicted_scorers) = 'array' AND jsonb_typeof(predicted_assists) = 'array') AS prediction_elements,
  (SELECT COALESCE(sum(points_awarded), 0) FROM public.predictions) AS points,
  (SELECT count(*) FROM public.goals) AS goals;

UPDATE public.matches m
SET scorers = pg_temp.sl_remap(m.scorers), assists = pg_temp.sl_remap(m.assists), own_goals = pg_temp.sl_remap(m.own_goals)
WHERE EXISTS (SELECT 1 FROM _sl_linked)
  AND EXISTS (SELECT 1 FROM (SELECT pg_temp.sl_refs(m.scorers) UNION ALL SELECT pg_temp.sl_refs(m.assists)
                             UNION ALL SELECT pg_temp.sl_refs(m.own_goals)) r(ref) JOIN _sl_linked l ON l.old_id = r.ref);

UPDATE public.predictions p
SET predicted_scorers = pg_temp.sl_remap(p.predicted_scorers), predicted_assists = pg_temp.sl_remap(p.predicted_assists)
WHERE EXISTS (SELECT 1 FROM _sl_linked)
  AND EXISTS (SELECT 1 FROM (SELECT pg_temp.sl_refs(p.predicted_scorers) UNION ALL SELECT pg_temp.sl_refs(p.predicted_assists)) r(ref)
              JOIN _sl_linked l ON l.old_id = r.ref);

-- Counter snapshot: one row per player.
INSERT INTO public.legacy_player_assist_counts (player_id, counter_value, event_assists_at_capture)
SELECT p.id, COALESCE(p.assists, 0), (SELECT count(*) FROM public.goals g WHERE g.assist_id = p.id)
FROM public.players p;

-- Data-preservation checks ----------------------------------------------------------------------------------------
-- roster-guard:start
DO $$
DECLARE
  v_before record;
  v_members integer;
  v_left text;
BEGIN
  SELECT * INTO v_before FROM _sl_before;
  SELECT count(*) INTO v_members FROM _sl_members;

  IF (SELECT count(*) FROM public.team_members) <> (SELECT count(*) FROM public.legacy_roster_map) THEN
    RAISE EXCEPTION 'Roster migration stopped: not every team member was mapped exactly once. Nothing was changed.';
  END IF;
  IF (SELECT count(*) FROM public.team_members) <> v_members THEN
    RAISE EXCEPTION 'Roster migration stopped: some team members have no team entry for their registration. Nothing was changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.players WHERE team_entry_id IS NOT NULL AND id NOT IN (SELECT player_id FROM public.roster_memberships)) THEN
    RAISE EXCEPTION 'Roster migration stopped: a player with a season roster place has no membership. Nothing was changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.legacy_roster_map lm WHERE NOT EXISTS (
      SELECT 1 FROM public.roster_memberships rm JOIN _sl_members s ON s.member_id = lm.team_member_id
      WHERE rm.player_id = lm.player_id AND rm.team_entry_id = s.entry_id)) THEN
    RAISE EXCEPTION 'Roster migration stopped: a mapped team member is not on its team''s roster. Nothing was changed.';
  END IF;
  IF (SELECT count(*) FROM public.goals) <> v_before.goals THEN
    RAISE EXCEPTION 'Roster migration stopped: the number of goals changed. Nothing was changed.';
  END IF;
  IF (SELECT COALESCE(sum(points_awarded), 0) FROM public.predictions) <> v_before.points THEN
    RAISE EXCEPTION 'Roster migration stopped: awarded prediction points changed. Nothing was changed.';
  END IF;
  IF (SELECT COALESCE(sum(jsonb_array_length(scorers)), 0) + COALESCE(sum(jsonb_array_length(assists)), 0) + COALESCE(sum(jsonb_array_length(own_goals)), 0)
      FROM public.matches WHERE jsonb_typeof(scorers) = 'array' AND jsonb_typeof(assists) = 'array' AND jsonb_typeof(own_goals) = 'array') <> v_before.match_elements
     OR (SELECT COALESCE(sum(jsonb_array_length(predicted_scorers)), 0) + COALESCE(sum(jsonb_array_length(predicted_assists)), 0)
         FROM public.predictions WHERE jsonb_typeof(predicted_scorers) = 'array' AND jsonb_typeof(predicted_assists) = 'array') <> v_before.prediction_elements THEN
    RAISE EXCEPTION 'Roster migration stopped: the number of scorer, assist or prediction entries changed. Nothing was changed.';
  END IF;
  SELECT string_agg(DISTINCT l.old_id, ', ') INTO v_left FROM _sl_linked l
  WHERE EXISTS (SELECT 1 FROM public.matches m, LATERAL (SELECT pg_temp.sl_refs(m.scorers) UNION ALL SELECT pg_temp.sl_refs(m.assists)
                  UNION ALL SELECT pg_temp.sl_refs(m.own_goals)) r(ref) WHERE r.ref = l.old_id)
     OR EXISTS (SELECT 1 FROM public.predictions p, LATERAL (SELECT pg_temp.sl_refs(p.predicted_scorers) UNION ALL SELECT pg_temp.sl_refs(p.predicted_assists)) r(ref)
                WHERE r.ref = l.old_id);
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'Roster migration stopped: references to linked team members remain (%). Nothing was changed.', v_left;
  END IF;
  IF (SELECT count(*) FROM public.legacy_player_assist_counts) <> (SELECT count(*) FROM public.players) THEN
    RAISE EXCEPTION 'Roster migration stopped: the assists counter snapshot is incomplete. Nothing was changed.';
  END IF;
  RAISE NOTICE 'rosters: % membership(s); % team member(s) mapped (% linked, % created)',
    (SELECT count(*) FROM public.roster_memberships), v_members,
    (SELECT count(*) FROM public.legacy_roster_map WHERE outcome = 'linked'),
    (SELECT count(*) FROM public.legacy_roster_map WHERE outcome = 'created');
END $$;
-- roster-guard:end

DROP TABLE _sl_before, _sl_linked, _sl_candidates, _sl_members;

-- History is never erased by deleting a player -------------------------------------------------------------------
ALTER TABLE public.goals DROP CONSTRAINT goals_player_id_fkey;
ALTER TABLE public.goals ADD CONSTRAINT goals_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE RESTRICT;

-- Season statistics -----------------------------------------------------------------------------------------------
-- One line per (season, player), derived from match events and never stored. Until the canonical match-event model
-- replaces both sources, a match records goals in two places: the goals table and the match JSON (scorers, assists;
-- elements are player-id strings or {"player_id": ...} objects). Freshers goals scored by registration-roster members
-- were recorded only in the JSON (their goals rows failed the players key). Per match and player the greater of the
-- two counts is used: the usual duplicated record counts once, and a JSON-only goal is no longer lost. The result is
-- the same for every viewer. The club is the team of the player's roster place in that season, else the goal's team.
CREATE OR REPLACE VIEW public.season_player_stats WITH (security_invoker = true) AS
WITH recorded AS (
  SELECT g.match_id, g.player_id, CASE WHEN g.is_own_goal THEN 0 ELSE 1 END AS goal, 0 AS assist, g.team_id
  FROM public.goals g WHERE g.player_id IS NOT NULL
  UNION ALL
  SELECT g.match_id, g.assist_id, 0, 1, g.team_id
  FROM public.goals g WHERE g.assist_id IS NOT NULL
), recorded_by_match AS (
  SELECT match_id, player_id, sum(goal) AS goals, sum(assist) AS assists,
         (array_agg(team_id ORDER BY team_id) FILTER (WHERE team_id IS NOT NULL))[1] AS team_id
  FROM recorded GROUP BY match_id, player_id
), listed AS (
  SELECT m.id AS match_id, x.ref, x.kind
  FROM public.matches m
  CROSS JOIN LATERAL (
    SELECT CASE jsonb_typeof(el) WHEN 'string' THEN el #>> '{}' WHEN 'object' THEN el ->> 'player_id' END AS ref, 'goal' AS kind
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.scorers) = 'array' THEN m.scorers ELSE '[]'::jsonb END) el
    UNION ALL
    SELECT CASE jsonb_typeof(el) WHEN 'string' THEN el #>> '{}' WHEN 'object' THEN el ->> 'player_id' END, 'assist'
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.assists) = 'array' THEN m.assists ELSE '[]'::jsonb END) el
  ) x
), listed_by_match AS (
  SELECT l.match_id, p.id AS player_id,
         count(*) FILTER (WHERE l.kind = 'goal') AS goals,
         count(*) FILTER (WHERE l.kind = 'assist') AS assists
  FROM listed l JOIN public.players p ON p.id::text = l.ref
  GROUP BY l.match_id, p.id
), per_match AS (
  SELECT COALESCE(r.match_id, l.match_id) AS match_id,
         COALESCE(r.player_id, l.player_id) AS player_id,
         GREATEST(COALESCE(r.goals, 0), COALESCE(l.goals, 0)) AS goals,
         GREATEST(COALESCE(r.assists, 0), COALESCE(l.assists, 0)) AS assists,
         r.team_id
  FROM recorded_by_match r
  FULL JOIN listed_by_match l ON l.match_id = r.match_id AND l.player_id = r.player_id
), lines AS (
  SELECT m.season_id, pm.player_id, sum(pm.goals)::integer AS goals, sum(pm.assists)::integer AS assists,
         (array_agg(pm.team_id ORDER BY pm.team_id) FILTER (WHERE pm.team_id IS NOT NULL))[1] AS event_team_id
  FROM per_match pm JOIN public.matches m ON m.id = pm.match_id
  WHERE m.season_id IS NOT NULL
  GROUP BY m.season_id, pm.player_id
)
SELECT l.season_id,
       p.id AS player_id,
       (p.first_name::text || ' ' || p.last_name::text) AS name,
       COALESCE(rt.name, et.name)::text AS club,
       l.goals,
       l.assists
FROM lines l
JOIN public.players p ON p.id = l.player_id
LEFT JOIN public.roster_memberships rm ON rm.player_id = l.player_id AND rm.season_id = l.season_id
LEFT JOIN public.team_entries te ON te.id = rm.team_entry_id
LEFT JOIN public.teams rt ON rt.id = te.team_id
LEFT JOIN public.teams et ON et.id = l.event_team_id;
COMMENT ON VIEW public.season_player_stats IS 'Goals and assists per player and season, derived from match events (per match and player, the greater of the goals table and the match JSON until the canonical event model replaces both). The club is the team of the player''s roster place in that season. The single source for every season statistic.';

-- Access ----------------------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin and Captain all access players" ON public.players;
DROP POLICY IF EXISTS "Allow authenticated deletes on players" ON public.players;
DROP POLICY IF EXISTS "Allow authenticated inserts on players" ON public.players;
DROP POLICY IF EXISTS "Allow authenticated updates on players" ON public.players;
CREATE POLICY "Dictators manage players" ON public.players TO authenticated
  USING (public.is_dictator()) WITH CHECK (public.is_dictator());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.players FROM anon;

ALTER TABLE public.roster_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read memberships of visible seasons" ON public.roster_memberships FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = season_id));
CREATE POLICY "Dictators manage roster memberships" ON public.roster_memberships TO authenticated
  USING (public.is_dictator()) WITH CHECK (public.is_dictator());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.roster_memberships FROM anon;

ALTER TABLE public.player_private_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dictators manage player private details" ON public.player_private_details TO authenticated
  USING (public.is_dictator()) WITH CHECK (public.is_dictator());
REVOKE ALL ON public.player_private_details FROM anon;

ALTER TABLE public.legacy_roster_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dictators read the roster mapping" ON public.legacy_roster_map FOR SELECT TO authenticated USING (public.is_dictator());
REVOKE ALL ON public.legacy_roster_map FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.legacy_roster_map FROM authenticated;

ALTER TABLE public.legacy_player_assist_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dictators read the assists snapshot" ON public.legacy_player_assist_counts FOR SELECT TO authenticated USING (public.is_dictator());
REVOKE ALL ON public.legacy_player_assist_counts FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.legacy_player_assist_counts FROM authenticated;

-- Captain roster edits (SL-003 allow-list) -------------------------------------------------------------------------
-- A captain may change, for a player on their assigned team in that season: position and jersey number (the season
-- roster place) and overall rating, attributes/play styles and portrait (the player's card). Never a name, email,
-- account link or the roster itself. Access needs both the captain role and the team's registration for that
-- season (SL-003 rule 3); a dictator may edit any roster.
CREATE FUNCTION public.captain_update_roster_player(
  p_membership_id uuid,
  p_position text,
  p_jersey_number integer,
  p_overall_rating integer,
  p_attributes jsonb,
  p_image_url text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_dictator boolean;
  v_is_captain boolean;
  v_player uuid;
  v_team uuid;
  v_season uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in';
  END IF;
  IF p_position IS NOT NULL AND p_position NOT IN
     ('GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'CF', 'ST') THEN
    RAISE EXCEPTION 'Choose a valid player position';
  END IF;
  IF p_jersey_number IS NOT NULL AND p_jersey_number NOT BETWEEN 1 AND 99 THEN
    RAISE EXCEPTION 'Jersey number must be between 1 and 99';
  END IF;
  IF p_overall_rating IS NULL OR p_overall_rating NOT BETWEEN 1 AND 99 THEN
    RAISE EXCEPTION 'Overall rating must be between 1 and 99';
  END IF;
  IF jsonb_typeof(p_attributes) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Player attributes must be an object';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_uid AND ur.role = 'dictator'),
         EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_uid AND ur.role = 'captain')
  INTO v_is_dictator, v_is_captain;

  SELECT rm.player_id, te.team_id, rm.season_id INTO v_player, v_team, v_season
  FROM public.roster_memberships rm JOIN public.team_entries te ON te.id = rm.team_entry_id
  WHERE rm.id = p_membership_id;

  -- A missing player and someone else's player give the same error, so callers cannot discover which exist.
  IF NOT FOUND OR (NOT v_is_dictator AND NOT EXISTS (
       SELECT 1 FROM public.team_registrations r
       WHERE r.captain_id = v_uid AND r.team_id = v_team AND r.season_id = v_season)) THEN
    RAISE EXCEPTION 'Player is not part of your assigned roster';
  END IF;
  IF NOT v_is_dictator AND NOT v_is_captain THEN
    RAISE EXCEPTION 'Captain access is required to update players';
  END IF;

  BEGIN
    UPDATE public.roster_memberships SET position = p_position, jersey_number = p_jersey_number WHERE id = p_membership_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Jersey number % is already taken on this team', p_jersey_number;
  END;
  UPDATE public.players
  SET overall_rating = p_overall_rating, attributes = p_attributes, image_url = p_image_url
  WHERE id = v_player;
END;
$$;
ALTER FUNCTION public.captain_update_roster_player(uuid, text, integer, integer, jsonb, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.captain_update_roster_player(uuid, text, integer, integer, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.captain_update_roster_player(uuid, text, integer, integer, jsonb, text) TO authenticated, service_role;

-- A dictator creates a player and places them on a season roster in one step (RLS applies: security invoker).
CREATE FUNCTION public.create_rostered_player(
  p_team_entry_id uuid,
  p_first_name text,
  p_last_name text,
  p_jersey_number integer DEFAULT NULL,
  p_position text DEFAULT NULL,
  p_overall_rating integer DEFAULT 50,
  p_attributes jsonb DEFAULT '{}'::jsonb,
  p_image_url text DEFAULT NULL,
  p_email text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_player uuid;
  v_season uuid;
BEGIN
  IF NOT public.is_dictator() THEN
    RAISE EXCEPTION 'Only a dictator can create players' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_first_name, ''))) NOT BETWEEN 1 AND 100 OR char_length(btrim(COALESCE(p_last_name, ''))) > 100 THEN
    RAISE EXCEPTION 'A first name (up to 100 characters) is required' USING ERRCODE = '22023';
  END IF;
  SELECT season_id INTO v_season FROM public.team_entries WHERE id = p_team_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team entry not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.players (first_name, last_name, overall_rating, attributes, image_url)
  VALUES (btrim(p_first_name), btrim(COALESCE(p_last_name, '')), COALESCE(p_overall_rating, 50), COALESCE(p_attributes, '{}'::jsonb), p_image_url)
  RETURNING id INTO v_player;
  INSERT INTO public.roster_memberships (player_id, team_entry_id, season_id, jersey_number, position)
  VALUES (v_player, p_team_entry_id, v_season, p_jersey_number, NULLIF(btrim(p_position), ''));
  IF NULLIF(btrim(p_email), '') IS NOT NULL THEN
    INSERT INTO public.player_private_details (player_id, email) VALUES (v_player, lower(btrim(p_email)));
  END IF;
  RETURN v_player;
END;
$$;
REVOKE ALL ON FUNCTION public.create_rostered_player(uuid, text, text, integer, text, integer, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_rostered_player(uuid, text, text, integer, text, integer, jsonb, text, text) TO authenticated, service_role;

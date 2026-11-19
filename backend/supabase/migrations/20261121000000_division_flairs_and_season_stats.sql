-- Per-division supporter flairs and season-scoped player statistics (expand step before the legacy contract).
--
-- * public.division_flairs replaces user_profiles.mens_team_flair / womens_team_flair: one row per user and division,
--   so any division (not only the two hard-coded columns) can carry a flair. Existing values are copied here; the old
--   columns are dropped by the following contract migration only after the copy is verified.
-- * public.season_player_stats replaces the division-string view top_scorers: goals and assists per player and
--   season, computed from the goals of that season's matches.
-- Forward-only.

CREATE TABLE public.division_flairs (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  division_id uuid NOT NULL REFERENCES public.divisions(id) ON DELETE CASCADE,
  team_name text NOT NULL CONSTRAINT division_flairs_team_name_length CHECK (char_length(btrim(team_name)) BETWEEN 1 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, division_id)
);
COMMENT ON TABLE public.division_flairs IS 'The team a user supports in a division (shown on fantasy leaderboards and profiles).';
CREATE TRIGGER division_flairs_updated_at BEFORE UPDATE ON public.division_flairs FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.division_flairs ENABLE ROW LEVEL SECURITY;
-- Flairs are public profile decoration, like user_profiles (which is publicly readable).
CREATE POLICY "Public read division flairs" ON public.division_flairs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Users manage their own division flairs" ON public.division_flairs TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.division_flairs FROM anon;

-- Copy the existing flairs (mens -> the division mapped from 'mens', womens -> from 'womens').
INSERT INTO public.division_flairs (user_id, division_id, team_name)
SELECT p.id, m.division_id, btrim(p.mens_team_flair)
FROM public.user_profiles p JOIN public.legacy_division_map m ON m.legacy_key = 'mens'
WHERE p.mens_team_flair IS NOT NULL AND btrim(p.mens_team_flair) <> ''
ON CONFLICT (user_id, division_id) DO NOTHING;
INSERT INTO public.division_flairs (user_id, division_id, team_name)
SELECT p.id, m.division_id, btrim(p.womens_team_flair)
FROM public.user_profiles p JOIN public.legacy_division_map m ON m.legacy_key = 'womens'
WHERE p.womens_team_flair IS NOT NULL AND btrim(p.womens_team_flair) <> ''
ON CONFLICT (user_id, division_id) DO NOTHING;

-- Goals and assists per player and season. Own goals do not count as goals scored.
CREATE VIEW public.season_player_stats WITH (security_invoker = true) AS
WITH events AS (
  SELECT m.season_id, g.player_id AS player_id, CASE WHEN g.is_own_goal THEN 0 ELSE 1 END AS goal, 0 AS assist
  FROM public.goals g JOIN public.matches m ON m.id = g.match_id
  WHERE g.player_id IS NOT NULL
  UNION ALL
  SELECT m.season_id, g.assist_id, 0, 1
  FROM public.goals g JOIN public.matches m ON m.id = g.match_id
  WHERE g.assist_id IS NOT NULL
)
SELECT e.season_id,
       p.id AS player_id,
       (p.first_name::text || ' ' || p.last_name::text) AS name,
       t.name::text AS club,
       sum(e.goal)::integer AS goals,
       sum(e.assist)::integer AS assists
FROM events e
JOIN public.players p ON p.id = e.player_id
LEFT JOIN public.teams t ON t.id = p.team_id
WHERE e.season_id IS NOT NULL
GROUP BY e.season_id, p.id, p.first_name, p.last_name, t.name;
COMMENT ON VIEW public.season_player_stats IS 'Goals and assists per player and season (replaces the division-string view top_scorers).';
GRANT SELECT ON public.season_player_stats TO anon, authenticated, service_role;

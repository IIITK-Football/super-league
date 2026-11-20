BEGIN;

-- seed-guard:start
-- This seed is for SYNTHETIC fixtures only (local development and the staging project). Refuse to
-- run on a database that holds real accounts: the seed's own accounts (lamb, river, diana, sydney,
-- fanNN @iiitkottayam.ac.in) are not counted, a handful of developer or tester accounts is fine,
-- and a real production database always has far more than 20 other accounts.
DO $$
DECLARE
  other_accounts integer;
BEGIN
  SELECT count(*) INTO other_accounts
  FROM auth.users
  WHERE email IS NULL
     OR email !~ '^(lamb|river|diana|sydney|fan[0-9]{2})@iiitkottayam\.ac\.in$';
  IF other_accounts > 20 THEN
    RAISE EXCEPTION 'Refusing to seed: found % non-fixture accounts. This seed is for synthetic fixtures only and must not run against a database with real users.', other_accounts;
  END IF;
END $$;
-- seed-guard:end

-- Offline, deterministic image placeholder (SVG data URI). Local fixtures must not
-- depend on third-party image hosts or production R2.
CREATE FUNCTION pg_temp.placeholder_svg(label text, bg text, size integer DEFAULT 256)
RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT 'data:image/svg+xml;base64,' || translate(encode(convert_to(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' || size || '" height="' || size
    || '" viewBox="0 0 100 100"><rect width="100" height="100" fill="' || bg
    || '"/><text x="50" y="58" font-family="sans-serif" font-size="26" font-weight="700" '
    || 'fill="#ffffff" text-anchor="middle">' || label || '</text></svg>', 'UTF8'), 'base64'), E'\n', '')
$f$;

-- Local fixture accounts. Their empty passwords mean they cannot sign in.
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
VALUES
  ('60000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'lamb@iiitkottayam.ac.in', '',
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"Jackson Lamb"}', now(), now(), false, false),
  ('60000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'river@iiitkottayam.ac.in', '',
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"River Cartwright"}', now(), now(), false, false),
  ('60000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'diana@iiitkottayam.ac.in', '',
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"Diana Taverner"}', now(), now(), false, false),
  ('60000000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'sydney@iiitkottayam.ac.in', '',
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"Sydney Adamu"}', now(), now(), false, false)
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE _mega_users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  full_name text NOT NULL,
  nickname text NOT NULL,
  role text NOT NULL,
  points integer NOT NULL
) ON COMMIT DROP;

INSERT INTO _mega_users VALUES
  ('60000000-0000-4000-8000-000000000001', 'lamb@iiitkottayam.ac.in', 'Jackson Lamb', 'Lamb', 'dictator', 48),
  ('60000000-0000-4000-8000-000000000002', 'river@iiitkottayam.ac.in', 'River Cartwright', 'River', 'captain', 36),
  ('60000000-0000-4000-8000-000000000003', 'diana@iiitkottayam.ac.in', 'Diana Taverner', 'Taverner', 'editor', 29),
  -- sydney is assigned as captain of a team entry below, so she holds the captain role (assignment alone is not access)
  ('60000000-0000-4000-8000-000000000004', 'sydney@iiitkottayam.ac.in', 'Sydney Adamu', 'Sydney', 'captain', 21);

-- 46 additional plain fixture accounts so leaderboards and pagination have volume.
CREATE TEMP TABLE _mega_fans ON COMMIT DROP AS
SELECT
  md5('mega-fan:' || n)::uuid AS id,
  'fan' || lpad(n::text, 2, '0') || '@iiitkottayam.ac.in' AS email,
  'Fixture Fan ' || lpad(n::text, 2, '0') AS full_name,
  'fan' || lpad(n::text, 2, '0') AS nickname,
  mod(n * 7, 50) AS points
FROM generate_series(1, 46) AS n;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
SELECT id, 'authenticated', 'authenticated', email, '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', full_name), now(), now(), false, false
FROM _mega_fans
ON CONFLICT (id) DO NOTHING;

-- Fantasy points are not stored on profiles: they are the season sums of graded predictions (season_fantasy_points).
INSERT INTO public.user_profiles (id, email, real_name, nickname)
SELECT id, email, full_name, nickname FROM _mega_fans
ON CONFLICT (id) DO UPDATE
SET email = EXCLUDED.email, real_name = EXCLUDED.real_name,
    nickname = EXCLUDED.nickname;

-- Plain fan accounts hold no role grant: a normal user is someone with no elevated grant.

INSERT INTO public.wc_leaderboard (user_id, points, updated_at)
SELECT id, points, now() FROM _mega_fans
ON CONFLICT (user_id) DO UPDATE SET points = EXCLUDED.points, updated_at = now();

INSERT INTO public.user_profiles (id, email, real_name, nickname)
SELECT id, email, full_name, nickname
FROM _mega_users
ON CONFLICT (id) DO UPDATE
SET email = EXCLUDED.email,
    real_name = EXCLUDED.real_name,
    nickname = EXCLUDED.nickname;

INSERT INTO public.user_roles (user_id, role)
SELECT id, role FROM _mega_users
ON CONFLICT (user_id, role) DO NOTHING;
-- Grants are independent: the editor also holds the scorer grant (its assignments are below).
INSERT INTO public.user_roles (user_id, role) VALUES ('60000000-0000-4000-8000-000000000003', 'scorer')
ON CONFLICT (user_id, role) DO NOTHING;
-- The captain of The Beef also scores one match, which exercises the captain-scores warning in the dashboard.
INSERT INTO public.user_roles (user_id, role) VALUES ('60000000-0000-4000-8000-000000000002', 'scorer')
ON CONFLICT (user_id, role) DO NOTHING;

-- Eight characters per show. Each division uses only its assigned show.
CREATE TEMP TABLE _mega_roster (
  show_name text NOT NULL,
  slot integer NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  position text NOT NULL,
  PRIMARY KEY (show_name, slot)
) ON COMMIT DROP;

INSERT INTO _mega_roster VALUES
  ('The Bear', 1, 'Carmen', 'Berzatto', 'Forward'),
  ('The Bear', 2, 'Sydney', 'Adamu', 'Midfielder'),
  ('The Bear', 3, 'Richard', 'Jerimovich', 'Defender'),
  ('The Bear', 4, 'Tina', 'Marrero', 'Midfielder'),
  ('The Bear', 5, 'Marcus', 'Brooks', 'Forward'),
  ('The Bear', 6, 'Natalie', 'Berzatto', 'Goalkeeper'),
  ('The Bear', 7, 'Ebraheim', 'Ebraheim', 'Defender'),
  ('The Bear', 8, 'Neil', 'Fak', 'Defender'),

  ('Slow Horses', 1, 'Jackson', 'Lamb', 'Forward'),
  ('Slow Horses', 2, 'River', 'Cartwright', 'Midfielder'),
  ('Slow Horses', 3, 'Catherine', 'Standish', 'Goalkeeper'),
  ('Slow Horses', 4, 'Diana', 'Taverner', 'Forward'),
  ('Slow Horses', 5, 'Louisa', 'Guy', 'Midfielder'),
  ('Slow Horses', 6, 'Min', 'Harper', 'Forward'),
  ('Slow Horses', 7, 'Roddy', 'Ho', 'Midfielder'),
  ('Slow Horses', 8, 'Shirley', 'Dander', 'Defender'),

  ('The Penguin', 1, 'Oswald', 'Cobb', 'Forward'),
  ('The Penguin', 2, 'Sofia', 'Falcone', 'Forward'),
  ('The Penguin', 3, 'Victor', 'Aguilar', 'Midfielder'),
  ('The Penguin', 4, 'Francis', 'Cobb', 'Goalkeeper'),
  ('The Penguin', 5, 'Salvatore', 'Maroni', 'Defender'),
  ('The Penguin', 6, 'Johnny', 'Viti', 'Midfielder'),
  ('The Penguin', 7, 'Eve', 'Karlo', 'Forward'),
  ('The Penguin', 8, 'Alberto', 'Falcone', 'Defender');

-- Generated placeholder portraits reused across local fixture players.
CREATE TEMP TABLE _mega_portraits (
  slot integer PRIMARY KEY,
  image_url text NOT NULL
) ON COMMIT DROP;

INSERT INTO _mega_portraits
SELECT slot, pg_temp.placeholder_svg('P' || slot,
  (ARRAY['#1f6feb','#8957e5','#d29922','#238636','#da3633','#0e8a8a','#bc4c00','#6e7681'])[slot])
FROM generate_series(1, 8) AS slot;

-- Teams are assigned to divisions by show:
-- mens = Slow Horses; womens = The Penguin; freshers = The Bear.
CREATE TEMP TABLE _mega_club_defs (
  show_name text NOT NULL,
  team_name text NOT NULL,
  short_name text NOT NULL,
  team_color text NOT NULL,
  PRIMARY KEY (show_name, team_name)
) ON COMMIT DROP;

INSERT INTO _mega_club_defs VALUES
  ('Slow Horses', 'Slough House', 'SLOUGH', '#4B5563'),
  ('Slow Horses', 'Regent''s Park', 'PARK', '#1D4ED8'),
  ('Slow Horses', 'The Dogs', 'DOGS', '#991B1B'),
  ('Slow Horses', 'Chieftain''s Office', 'CHIEF', '#6B4C3B'),
  ('Slow Horses', 'Lamb''s Unit', 'LAMB', '#3D4652'),
  ('Slow Horses', 'Taverner''s Unit', 'TAVERNER', '#2E4D78'),
  ('Slow Horses', 'Cartwright''s Team', 'CARTWRIGHT', '#58705B'),
  ('Slow Horses', 'MI5', 'MI5', '#27364A'),

  ('The Penguin', 'Falcone Family', 'FALCONE', '#30343B'),
  ('The Penguin', 'Maroni Crew', 'MARONI', '#49616B'),
  ('The Penguin', 'Iceberg Lounge', 'ICEBERG', '#315A78'),
  ('The Penguin', 'Crown Point', 'CROWN', '#78594C'),
  ('The Penguin', 'Cobb''s Crew', 'COBB', '#4A3B37'),
  ('The Penguin', 'Gotham Docks', 'DOCKS', '#374B5B'),
  ('The Penguin', 'Gotham Police', 'GCPD', '#344B70'),
  ('The Penguin', 'Gotham City Hall', 'CITYHALL', '#62554B'),

  ('The Bear', 'The Beef', 'BEEF', '#8B2E24'),
  ('The Bear', 'Ever', 'EVER', '#C27B45'),
  ('The Bear', 'Copenhagen', 'COPE', '#476B63'),
  ('The Bear', 'KBL', 'KBL', '#4A5268'),
  ('The Bear', 'The Brigade', 'BRIGADE', '#6B493B'),
  ('The Bear', 'Family Meal', 'MEAL', '#77704B'),
  ('The Bear', 'Berzatto Family', 'BERZATTO', '#604F4A'),
  ('The Bear', 'The Dining Room', 'DINING', '#536254');

CREATE TEMP TABLE _mega_division_shows (
  division text PRIMARY KEY,
  show_name text NOT NULL
) ON COMMIT DROP;

INSERT INTO _mega_division_shows VALUES
  ('mens', 'Slow Horses'),
  ('womens', 'The Penguin'),
  ('freshers', 'The Bear');

-- Divisions are data records, each with one current season (2026). The `division` text above is only this seed's
-- internal key for choosing a show. Matched by slug, so a rerun (and staging data) reuses the existing rows.
CREATE TEMP TABLE _mega_division_defs (
  division text PRIMARY KEY,
  slug text NOT NULL,
  name text NOT NULL,
  short_name text NOT NULL,
  sort_order integer NOT NULL,
  format text NOT NULL
) ON COMMIT DROP;

INSERT INTO _mega_division_defs VALUES
  ('mens', 'super-league', 'Super League', 'SL', 1, 'league'),
  ('womens', 'wsl', 'WSL', 'WSL', 2, 'knockout'),
  ('freshers', 'freshers', 'Freshers', 'Freshers', 3, 'knockout');

INSERT INTO public.divisions (slug, name, short_name, sort_order, created_by)
SELECT slug, name, short_name, sort_order, NULL FROM _mega_division_defs
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.seasons (division_id, slug, name, status, is_current, format, created_by)
SELECT d.id, '2026', '2026', 'active', NOT EXISTS (SELECT 1 FROM public.seasons c WHERE c.division_id = d.id AND c.is_current), def.format, NULL
FROM _mega_division_defs def JOIN public.divisions d ON d.slug = def.slug
ON CONFLICT (division_id, slug) DO NOTHING;

INSERT INTO public.season_sections (season_id, section_key, enabled, nav_visible, sort_order)
SELECT s.id, t.key, t.default_enabled, t.default_enabled, t.default_sort_order
FROM _mega_division_defs def
JOIN public.divisions d ON d.slug = def.slug
JOIN public.seasons s ON s.division_id = d.id AND s.slug = '2026'
CROSS JOIN public.section_types t
ON CONFLICT (season_id, section_key) DO NOTHING;

CREATE TEMP TABLE _mega_seasons ON COMMIT DROP AS
SELECT def.division, s.id AS season_id
FROM _mega_division_defs def
JOIN public.divisions d ON d.slug = def.slug
JOIN public.seasons s ON s.division_id = d.id AND s.slug = '2026';

CREATE TEMP TABLE _mega_teams ON COMMIT DROP AS
SELECT
  md5('mega-team:' || d.division || ':' || c.short_name)::uuid AS id,
  d.division,
  c.show_name,
  c.team_name,
  c.short_name,
  c.team_color,
  pg_temp.placeholder_svg(c.short_name, c.team_color) AS logo_url
FROM _mega_club_defs c
JOIN _mega_division_shows d USING (show_name);

INSERT INTO public.teams (id, name, logo_url, short_name, team_color)
SELECT id, team_name, logo_url, short_name, team_color
FROM _mega_teams
ON CONFLICT (id) DO NOTHING;

-- Each team plays the 2026 season of its division.
INSERT INTO public.team_entries (team_id, season_id)
SELECT t.id, s.season_id FROM _mega_teams t JOIN _mega_seasons s USING (division)
ON CONFLICT (team_id, season_id) DO NOTHING;

-- 24 teams × 8 players = 192 player identities (the reusable FUT card: name, rating, attributes, portrait).
INSERT INTO public.players (
  id, first_name, last_name, overall_rating, image_url, attributes
)
SELECT
  md5('mega-player:' || t.id::text || ':' || r.slot)::uuid,
  r.first_name,
  r.last_name,
  55 + mod(r.slot * 11 + length(t.team_name), 40),
  portrait.image_url,
  jsonb_build_object('stats', jsonb_build_object(
    'Pace', jsonb_build_object('total', 50 + mod(r.slot * 9, 45)),
    'Passing', jsonb_build_object('total', 50 + mod(r.slot * 7, 45)),
    'Shooting', jsonb_build_object('total', 50 + mod(r.slot * 13, 45))
  ))
FROM _mega_teams t
JOIN _mega_roster r ON r.show_name = t.show_name
JOIN _mega_portraits portrait ON portrait.slot = r.slot
ON CONFLICT (id) DO NOTHING;

-- Each player is on the 2026 roster of their team (a roster membership on the team's 2026 entry), with the
-- season's jersey number and position. Goals and assists are never stored here: they come from match events.
INSERT INTO public.roster_memberships (player_id, team_entry_id, season_id, jersey_number, position)
SELECT
  md5('mega-player:' || t.id::text || ':' || r.slot)::uuid,
  e.id,
  e.season_id,
  r.slot,
  r.position
FROM _mega_teams t
JOIN _mega_seasons ms ON ms.division = t.division
JOIN public.team_entries e ON e.team_id = t.id AND e.season_id = ms.season_id
JOIN _mega_roster r ON r.show_name = t.show_name
ON CONFLICT (player_id, season_id) DO NOTHING;

-- 8 teams per division, home and away: 56 matches per division.
CREATE TEMP TABLE _mega_match_defs ON COMMIT DROP AS
WITH ranked_teams AS (
  SELECT
    t.*,
    row_number() OVER (PARTITION BY t.division ORDER BY t.team_name)::integer AS team_no
  FROM _mega_teams t
),
pairs AS (
  SELECT
    h.division,
    h.id AS home_team_id,
    a.id AS away_team_id,
    h.show_name AS home_show,
    row_number() OVER (
      PARTITION BY h.division
      ORDER BY h.team_no, a.team_no
    )::integer AS match_no
  FROM ranked_teams h
  JOIN ranked_teams a
    ON a.division = h.division
   AND a.id <> h.id
)
SELECT
  md5('mega-match:' || division || ':' || home_team_id::text || ':' || away_team_id::text)::uuid AS id,
  division,
  home_team_id,
  away_team_id,
  match_no,
  CASE WHEN match_no <= 41
       THEN mod(abs(hashtext(home_team_id::text || away_team_id::text)::bigint), 5)::integer
       ELSE 0 END AS home_score,
  CASE WHEN match_no <= 41
       THEN mod(abs(hashtext(away_team_id::text || home_team_id::text)::bigint), 5)::integer
       ELSE 0 END AS away_score,
  home_show,
  CASE
    WHEN match_no <= 40 THEN 'completed'
    WHEN match_no = 41 THEN 'live'
    ELSE 'scheduled'
  END AS status,
  CASE
    WHEN match_no <= 40
      THEN timestamptz '2026-08-01 12:00:00+00' + (match_no - 1) * interval '12 hours'
    WHEN match_no = 41 THEN now() - interval '67 minutes'
    ELSE now() + (match_no - 41) * interval '1 day'
  END AS match_date
FROM pairs;

INSERT INTO public.matches (
  id, home_team_id, away_team_id, home_score, away_score,
  status, date, venue, season_id, scorers, assists, own_goals,
  minute, is_graded, timer_start_time, timer_calibration
)
SELECT
  m.id,
  m.home_team_id,
  m.away_team_id,
  m.home_score,
  m.away_score,
  m.status,
  m.match_date,
  CASE m.home_show
    WHEN 'The Bear' THEN 'Chicago'
    WHEN 'Slow Horses' THEN 'London'
    ELSE 'Gotham'
  END,
  (SELECT season_id FROM _mega_seasons s WHERE s.division = m.division),
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  CASE m.status WHEN 'completed' THEN '90' WHEN 'live' THEN '67' ELSE '0' END,
  m.status = 'completed',
  CASE WHEN m.status = 'live' THEN now() - interval '67 minutes' ELSE NULL END,
  0
FROM _mega_match_defs m
-- A rerun refreshes the time-dependent match state (the live match and the upcoming fixtures are
-- relative to "now") and restores fixture scores, without ever inserting a second row. Everything
-- else in this seed stays DO NOTHING, so edits made by testers to teams, players and so on survive.
ON CONFLICT (id) DO UPDATE SET
  home_score = EXCLUDED.home_score,
  away_score = EXCLUDED.away_score,
  status = EXCLUDED.status,
  date = EXCLUDED.date,
  minute = EXCLUDED.minute,
  is_graded = EXCLUDED.is_graded,
  timer_start_time = EXCLUDED.timer_start_time,
  timer_calibration = EXCLUDED.timer_calibration;

-- Normalized goals for completed and live matches.
INSERT INTO public.goals (
  id, match_id, player_id, team_id, minute, assist_id, is_own_goal, scored_at
)
SELECT
  md5('mega-goal:' || m.id::text || ':' || s.side || ':' || g.goal_no)::uuid,
  m.id,
  md5('mega-player:' || s.scoring_team_id::text || ':' || p.slot)::uuid,
  s.scoring_team_id,
  ((g.goal_no * 13 + m.match_no) % 89 + 1)::text,
  CASE
    WHEN mod(g.goal_no, 3) = 0 THEN NULL
    ELSE md5(
      'mega-player:' || s.scoring_team_id::text || ':' || (mod(p.slot, 8) + 1)
    )::uuid
  END,
  false,
  m.match_date + (((g.goal_no * 13 + m.match_no) % 89 + 1) * interval '1 minute')
FROM _mega_match_defs m
CROSS JOIN LATERAL (
  SELECT 'home'::text AS side, m.home_team_id AS scoring_team_id, m.home_score AS goal_count
  UNION ALL
  SELECT 'away'::text, m.away_team_id, m.away_score
) s
CROSS JOIN LATERAL generate_series(1, s.goal_count) AS g(goal_no)
CROSS JOIN LATERAL (
  SELECT (mod(abs(hashtext(m.id::text || s.side || g.goal_no::text)::bigint), 8) + 1)::integer AS slot
) p
WHERE m.status IN ('completed', 'live')
ON CONFLICT (id) DO NOTHING;

-- Populate the legacy JSON scorer fields from normalized goals.
UPDATE public.matches m
SET
  scorers = COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object('player_id', g.player_id, 'team_id', g.team_id, 'minute', g.minute)
      ORDER BY g.scored_at
    )
    FROM public.goals g
    WHERE g.match_id = m.id
  ), '[]'::jsonb),
  assists = COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object('player_id', g.assist_id, 'team_id', g.team_id, 'minute', g.minute)
      ORDER BY g.scored_at
    )
    FROM public.goals g
    WHERE g.match_id = m.id AND g.assist_id IS NOT NULL
  ), '[]'::jsonb)
WHERE m.id IN (SELECT id FROM _mega_match_defs);

-- Two freshers team-builder registrations. A registration's team_name is the team's own name (the captain's name
-- here once made The Beef's registration read "Cartwright").
CREATE TEMP TABLE _mega_registrations (
  id uuid PRIMARY KEY,
  captain_id uuid NOT NULL,
  team_name text NOT NULL,
  team_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO _mega_registrations VALUES
  (
    '70000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000002',
    'The Beef',
    md5('mega-team:freshers:BEEF')::uuid
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000004',
    'Ever',
    md5('mega-team:freshers:EVER')::uuid
  );

INSERT INTO public.team_registrations (id, captain_id, team_name, season_id, team_id)
SELECT id, captain_id, team_name, (SELECT season_id FROM _mega_seasons WHERE division = 'freshers'), team_id
FROM _mega_registrations
ON CONFLICT (id) DO NOTHING;

-- Each registration is the captain assignment of its team entry (team_registrations is retired in a later migration).
INSERT INTO public.captain_assignments (team_entry_id, user_id, assigned_at)
SELECT e.id, r.captain_id, now()
FROM _mega_registrations r
JOIN public.team_entries e ON e.team_id = r.team_id
  AND e.season_id = (SELECT season_id FROM _mega_seasons WHERE division = 'freshers')
ON CONFLICT (team_entry_id) DO NOTHING;

-- Scorers: the editor scores a whole season (men's), and the Beef's captain scores one scheduled match.
INSERT INTO public.scorer_assignments (user_id, season_id)
SELECT '60000000-0000-4000-8000-000000000003'::uuid, season_id FROM _mega_seasons WHERE division = 'mens'
ON CONFLICT DO NOTHING;
INSERT INTO public.scorer_assignments (user_id, match_id)
SELECT '60000000-0000-4000-8000-000000000002'::uuid, (SELECT id FROM public.matches m WHERE m.status = 'scheduled' ORDER BY m.date, m.id LIMIT 1)
ON CONFLICT DO NOTHING;

-- The Freshers team-builder rosters are the season rosters above (no separate member table).
-- History fixture: the first Super League team's slot-1 player also plays the Freshers 2026 season for The Beef,
-- so one identity has roster places in two divisions' seasons.
INSERT INTO public.roster_memberships (player_id, team_entry_id, season_id, jersey_number, position)
SELECT
  md5('mega-player:' || mens.id::text || ':1')::uuid,
  e.id,
  e.season_id,
  99,
  'Forward'
FROM (SELECT id FROM _mega_teams WHERE division = 'mens' ORDER BY team_name LIMIT 1) mens
JOIN public.team_entries e ON e.team_id = md5('mega-team:freshers:BEEF')::uuid
  AND e.season_id = (SELECT season_id FROM _mega_seasons WHERE division = 'freshers')
ON CONFLICT (player_id, season_id) DO NOTHING;


-- Four users predict all 168 league matches.
INSERT INTO public.predictions (
  id, user_id, match_id, predicted_home_score, predicted_away_score,
  predicted_scorers, predicted_assists, points_awarded, status
)
SELECT
  md5('mega-prediction:' || u.id::text || ':' || m.id::text)::uuid,
  u.id,
  m.id,
  mod(abs(hashtext(u.id::text || m.id::text)::bigint), 5)::integer,
  mod(abs(hashtext(m.id::text || u.id::text)::bigint), 5)::integer,
  '[]'::jsonb,
  '[]'::jsonb,
  CASE WHEN m.status = 'completed'
    THEN mod(abs(hashtext(u.id::text || m.id::text)::bigint), 11)::integer
    ELSE 0
  END,
  CASE WHEN m.status = 'completed' THEN 'graded' ELSE 'pending' END
FROM _mega_users u
CROSS JOIN _mega_match_defs m
ON CONFLICT (id) DO NOTHING;

-- 24 newsletter items with stock images.
INSERT INTO public.newsletter (id, title, summary, author, image_url, category, content, date)
SELECT
  md5('mega-news:' || n::text)::uuid,
  CASE mod(n, 6)
    WHEN 0 THEN 'Matchday ' || n
    WHEN 1 THEN 'Fixture Update ' || n
    WHEN 2 THEN 'League Notes ' || n
    WHEN 3 THEN 'Round-up ' || n
    WHEN 4 THEN 'Team Sheet ' || n
    ELSE 'Results ' || n
  END,
  'Results and upcoming fixtures from the local test season.',
  (ARRAY['Jackson Lamb', 'Sydney Adamu', 'Catherine Standish', 'Victor Aguilar'])[((n - 1) % 4) + 1],
  (SELECT image_url FROM _mega_portraits WHERE slot = ((n - 1) % 8) + 1),
  CASE mod(n, 3) WHEN 0 THEN 'Preview' WHEN 1 THEN 'Match report' ELSE 'League update' END,
  jsonb_build_array(jsonb_build_object(
    'type', 'paragraph',
    'text', 'Local fixture data for development.'
  )),
  now() - (n * interval '1 day')
FROM generate_series(1, 24) AS n
ON CONFLICT (id) DO NOTHING;


-- Fantasy tables have no division column, so this is a separate mixed-show sample.
CREATE TEMP TABLE _mega_wc_clubs (
  id bigint PRIMARY KEY,
  show_name text NOT NULL,
  team_name text NOT NULL,
  abbreviation text NOT NULL,
  group_name text NOT NULL
) ON COMMIT DROP;

INSERT INTO _mega_wc_clubs VALUES
  (101, 'The Bear', 'The Beef', 'BEEF', 'A'),
  (102, 'The Bear', 'Ever', 'EVER', 'A'),
  (103, 'The Bear', 'Copenhagen', 'COPE', 'A'),
  (104, 'The Bear', 'KBL', 'KBL', 'A'),
  (105, 'Slow Horses', 'Slough House', 'SLOUGH', 'B'),
  (106, 'Slow Horses', 'Regent''s Park', 'PARK', 'B'),
  (107, 'Slow Horses', 'The Dogs', 'DOGS', 'B'),
  (108, 'Slow Horses', 'Chieftain''s Office', 'CHIEF', 'B'),
  (109, 'The Penguin', 'Falcone Family', 'FALCONE', 'C'),
  (110, 'The Penguin', 'Maroni Crew', 'MARONI', 'C'),
  (111, 'The Penguin', 'Iceberg Lounge', 'ICEBERG', 'C'),
  (112, 'The Penguin', 'Crown Point', 'CROWN', 'C'),
  (113, 'The Bear', 'Family Meal', 'MEAL', 'D'),
  (114, 'Slow Horses', 'MI5', 'MI5', 'D'),
  (115, 'The Penguin', 'Gotham Docks', 'DOCKS', 'D'),
  (116, 'The Penguin', 'Gotham City Hall', 'CITY', 'D');

INSERT INTO public.wc_teams (id, name, logo_url, group_name, abbreviation)
SELECT
  id,
  team_name,
  pg_temp.placeholder_svg(abbreviation, '#343A40'),
  group_name,
  abbreviation
FROM _mega_wc_clubs
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.wc_players (id, team_id, name, position)
SELECT
  club.id * 100 + roster.slot,
  club.id::integer,
  roster.first_name || ' ' || roster.last_name,
  roster.position
FROM _mega_wc_clubs club
JOIN _mega_roster roster ON roster.show_name = club.show_name
WHERE roster.slot <= 4
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE _mega_wc_match_defs (
  id bigint PRIMARY KEY,
  home_team_id bigint NOT NULL,
  away_team_id bigint NOT NULL,
  stage text NOT NULL,
  status text NOT NULL,
  match_date timestamptz NOT NULL,
  home_score integer NOT NULL,
  away_score integer NOT NULL
) ON COMMIT DROP;

-- 24 completed group fixtures.
INSERT INTO _mega_wc_match_defs
SELECT
  row_number() OVER (ORDER BY home.group_name, home.id, away.id)::bigint,
  home.id,
  away.id,
  'Group ' || home.group_name,
  'Completed',
  timestamptz '2026-09-01 12:00:00+00'
    + (row_number() OVER (ORDER BY home.group_name, home.id, away.id) - 1) * interval '1 day',
  mod(abs(hashtext(home.id::text || away.id::text)::bigint), 5)::integer,
  mod(abs(hashtext(away.id::text || home.id::text)::bigint), 5)::integer
FROM _mega_wc_clubs home
JOIN _mega_wc_clubs away
  ON away.group_name = home.group_name
 AND away.id > home.id;

-- 16 scheduled knockout fixtures.
INSERT INTO _mega_wc_match_defs VALUES
  (25, 101, 106, 'Round of 16', 'Not Started', now() + interval '2 days', 0, 0),
  (26, 102, 105, 'Round of 16', 'Not Started', now() + interval '2 days', 0, 0),
  (27, 109, 114, 'Round of 16', 'Not Started', now() + interval '3 days', 0, 0),
  (28, 110, 113, 'Round of 16', 'Not Started', now() + interval '3 days', 0, 0),
  (29, 103, 108, 'Round of 16', 'Not Started', now() + interval '4 days', 0, 0),
  (30, 104, 107, 'Round of 16', 'Not Started', now() + interval '4 days', 0, 0),
  (31, 111, 116, 'Round of 16', 'Not Started', now() + interval '5 days', 0, 0),
  (32, 112, 115, 'Round of 16', 'Not Started', now() + interval '5 days', 0, 0),
  (33, 101, 109, 'Quarter-final', 'Not Started', now() + interval '7 days', 0, 0),
  (34, 102, 110, 'Quarter-final', 'Not Started', now() + interval '7 days', 0, 0),
  (35, 103, 111, 'Quarter-final', 'Not Started', now() + interval '8 days', 0, 0),
  (36, 104, 112, 'Quarter-final', 'Not Started', now() + interval '8 days', 0, 0),
  (37, 101, 103, 'Semi-final', 'Not Started', now() + interval '10 days', 0, 0),
  (38, 102, 104, 'Semi-final', 'Not Started', now() + interval '10 days', 0, 0),
  (39, 101, 102, 'Third-place match', 'Not Started', now() + interval '12 days', 0, 0),
  (40, 103, 104, 'Final', 'Not Started', now() + interval '13 days', 0, 0);

INSERT INTO public.wc_matches (
  id, home_team_id, away_team_id, home_score, away_score,
  status, date, stage, scorers, assists, is_graded
)
SELECT
  m.id,
  m.home_team_id,
  m.away_team_id,
  m.home_score,
  m.away_score,
  m.status,
  m.match_date,
  m.stage,
  CASE WHEN m.home_score > 0
    THEN jsonb_build_array(jsonb_build_object(
      'player_id', m.home_team_id * 100 + 1, 'minute', '34'
    ))
    ELSE '[]'::jsonb
  END,
  '[]'::jsonb,
  m.status = 'Completed'
FROM _mega_wc_match_defs m
ON CONFLICT (id) DO NOTHING;

-- Fantasy predictions: four users × 40 fixtures.
INSERT INTO public.wc_predictions (
  id, user_id, match_id, predicted_home_score, predicted_away_score,
  predicted_scorers, predicted_assists, points_awarded, status
)
SELECT
  md5('mega-wc-prediction:' || u.id::text || ':' || m.id::text)::uuid,
  u.id,
  m.id,
  mod(abs(hashtext(u.id::text || m.id::text)::bigint), 5)::integer,
  mod(abs(hashtext(m.id::text || u.id::text)::bigint), 5)::integer,
  '[]'::jsonb,
  '[]'::jsonb,
  CASE WHEN m.status = 'Completed' THEN mod(m.id::integer, 13) ELSE 0 END,
  CASE WHEN m.status = 'Completed' THEN 'graded' ELSE 'pending' END
FROM _mega_users u
CROSS JOIN _mega_wc_match_defs m
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.wc_leaderboard (user_id, points, updated_at)
SELECT id, points, now() FROM _mega_users
ON CONFLICT (user_id) DO UPDATE
SET points = EXCLUDED.points, updated_at = now();

CREATE TEMP TABLE _mega_wc_groups ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    group_name,
    id,
    row_number() OVER (PARTITION BY group_name ORDER BY id)::integer AS position
  FROM _mega_wc_clubs
)
SELECT
  group_name,
  max(id) FILTER (WHERE position = 1) AS first_team,
  max(id) FILTER (WHERE position = 2) AS second_team,
  max(id) FILTER (WHERE position = 3) AS third_team,
  max(id) FILTER (WHERE position = 4) AS fourth_team
FROM ranked
GROUP BY group_name;

INSERT INTO public.wc_group_predictions (
  id, user_id, group_name,
  predicted_1st_place, predicted_2nd_place,
  predicted_3rd_place, predicted_4th_place
)
SELECT
  md5('mega-group-prediction:' || u.id::text || ':' || g.group_name)::uuid,
  u.id,
  g.group_name,
  g.first_team,
  g.second_team,
  g.third_team,
  g.fourth_team
FROM _mega_users u
CROSS JOIN _mega_wc_groups g
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.wc_award_predictions (
  user_id, golden_boot_id, golden_ball_id, golden_glove_id, points_awarded
)
SELECT u.id, 10101, 10502, 10903, 0
FROM _mega_users u
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.wc_knockout_predictions (
  id, user_id, advancing_third_place, round_of_16, quarter_finals,
  semi_finals, final, champion_id
)
SELECT
  md5('mega-knockout-prediction:' || u.id::text)::uuid,
  u.id,
  ARRAY['A', 'C']::text[],
  ARRAY[101, 102, 109, 110, 103, 104, 111, 112]::integer[],
  ARRAY[101, 102, 103, 104]::integer[],
  ARRAY[101, 103]::integer[],
  ARRAY[101, 103]::integer[],
  101
FROM _mega_users u
ON CONFLICT (id) DO NOTHING;

-- Season dates follow the season's matches (docs/decisions/D-01-division-season-mapping.md).
UPDATE public.seasons s
SET starts_on = d.first_day, ends_on = d.last_day
FROM (
  SELECT m.season_id, min((m.date AT TIME ZONE 'Asia/Kolkata')::date) AS first_day, max((m.date AT TIME ZONE 'Asia/Kolkata')::date) AS last_day
  FROM public.matches m JOIN _mega_seasons ms ON ms.season_id = m.season_id
  GROUP BY m.season_id
) d
WHERE s.id = d.season_id AND (s.starts_on IS DISTINCT FROM d.first_day OR s.ends_on IS DISTINCT FROM d.last_day);

-- Seed accounts are written straight into auth.users, so give them what Auth itself writes: the default instance and
-- empty (not NULL) token columns. Without these, the Auth API cannot load the account (it is missing from the admin
-- listing and cannot be confirmed or updated). Repairs accounts seeded before this rule; re-running changes nothing.
UPDATE auth.users
SET instance_id = COALESCE(instance_id, '00000000-0000-0000-0000-000000000000'),
    confirmation_token = COALESCE(confirmation_token, ''), recovery_token = COALESCE(recovery_token, ''),
    email_change_token_new = COALESCE(email_change_token_new, ''), email_change = COALESCE(email_change, ''),
    email_change_token_current = COALESCE(email_change_token_current, ''), phone_change = COALESCE(phone_change, ''),
    phone_change_token = COALESCE(phone_change_token, ''), reauthentication_token = COALESCE(reauthentication_token, '')
WHERE email ~ '^(lamb|river|diana|sydney|fan[0-9]{2})@iiitkottayam\.ac\.in$'
  AND (instance_id IS NULL OR confirmation_token IS NULL OR recovery_token IS NULL OR email_change_token_new IS NULL
       OR email_change IS NULL OR email_change_token_current IS NULL OR phone_change IS NULL OR phone_change_token IS NULL
       OR reauthentication_token IS NULL);

-- Account-linked players: one verified fan account (fan01) linked to one player, Jackson Lamb, who plays for two
-- teams. Every other seed account stays unverified, so linking one shows the refusal. Re-running changes nothing.
UPDATE auth.users SET email_confirmed_at = now()
WHERE email = 'fan01@iiitkottayam.ac.in' AND email_confirmed_at IS NULL;
UPDATE public.players SET user_id = (SELECT id FROM auth.users WHERE email = 'fan01@iiitkottayam.ac.in')
WHERE id = (SELECT id FROM public.players WHERE first_name = 'Jackson' AND last_name = 'Lamb' ORDER BY id LIMIT 1)
  AND user_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.players p JOIN auth.users u ON u.id = p.user_id WHERE u.email = 'fan01@iiitkottayam.ac.in');

-- Account matching (private match keys of unlinked legacy players; no contact emails exist any more). Seven WSL players
-- of the first WSL team, one per case the dictator's matching preview shows:
--   slot 2  fan02 (verified)                 ready: linked by the dictator's "link all ready matches"
--   slot 3  fan03, and slot 4 fan03 too      duplicate: resolved by hand
--   slot 5  fan04 (unverified)               waiting for verification: linked automatically when fan04 verifies
--   slot 6  fan01 (already linked to Lamb)   conflict
--   slot 7  roster.fixture@…                 no account (on a project converted from the old seed, this address also
--                                            belonged to a men's player's contact email, so it shows as a duplicate)
--   slot 8  auto.link.fixture@…              no account; the staging checks confirm an account with this address to
--                                            test the automatic link, then delete it (the next seed run restores the key)
-- fan02 is verified BEFORE its key is added, as for a legacy player whose person signed up long ago. A key is only
-- (re)added while its player is unlinked and its account has no player, so a re-run never undoes a link.
UPDATE auth.users SET email_confirmed_at = now()
WHERE email = 'fan02@iiitkottayam.ac.in' AND email_confirmed_at IS NULL;
INSERT INTO public.player_link_keys (player_id, email)
SELECT p.id, k.email
FROM (VALUES (2, 'fan02@iiitkottayam.ac.in'), (3, 'fan03@iiitkottayam.ac.in'), (4, 'fan03@iiitkottayam.ac.in'),
             (5, 'fan04@iiitkottayam.ac.in'), (6, 'fan01@iiitkottayam.ac.in'), (7, 'roster.fixture@iiitkottayam.ac.in'),
             (8, 'auto.link.fixture@iiitkottayam.ac.in')) AS k(slot, email)
CROSS JOIN (SELECT id FROM _mega_teams WHERE division = 'womens' ORDER BY team_name LIMIT 1) wsl
JOIN public.players p ON p.id = md5('mega-player:' || wsl.id::text || ':' || k.slot)::uuid
WHERE p.user_id IS NULL
  AND (k.email = 'fan01@iiitkottayam.ac.in'
       OR NOT EXISTS (SELECT 1 FROM public.players o JOIN auth.users u ON u.id = o.user_id WHERE u.email = k.email))
ON CONFLICT (player_id) DO NOTHING;

COMMIT;

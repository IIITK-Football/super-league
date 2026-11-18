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

INSERT INTO public.user_profiles (id, email, real_name, nickname, points)
SELECT id, email, full_name, nickname, points FROM _mega_fans
ON CONFLICT (id) DO UPDATE
SET email = EXCLUDED.email, real_name = EXCLUDED.real_name,
    nickname = EXCLUDED.nickname, points = EXCLUDED.points;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'default' FROM _mega_fans
ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.wc_leaderboard (user_id, points, updated_at)
SELECT id, points, now() FROM _mega_fans
ON CONFLICT (user_id) DO UPDATE SET points = EXCLUDED.points, updated_at = now();

INSERT INTO public.user_profiles (id, email, real_name, nickname, points)
SELECT id, email, full_name, nickname, points
FROM _mega_users
ON CONFLICT (id) DO UPDATE
SET email = EXCLUDED.email,
    real_name = EXCLUDED.real_name,
    nickname = EXCLUDED.nickname,
    points = EXCLUDED.points;

INSERT INTO public.user_roles (user_id, role)
SELECT id, role FROM _mega_users
ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

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

INSERT INTO public.teams (id, name, logo_url, division, short_name, team_color)
SELECT id, team_name, logo_url, division, short_name, team_color
FROM _mega_teams
ON CONFLICT (id) DO NOTHING;

-- 24 teams × 8 players = 192 players.
INSERT INTO public.players (
  id, team_id, first_name, last_name, position,
  jersey_number, assists, overall_rating, image_url, attributes
)
SELECT
  md5('mega-player:' || t.id::text || ':' || r.slot)::uuid,
  t.id,
  r.first_name,
  r.last_name,
  r.position,
  r.slot,
  mod(r.slot * 7, 9),
  55 + mod(r.slot * 11 + length(t.team_name), 40),
  portrait.image_url,
  jsonb_build_object(
    'pace', 50 + mod(r.slot * 9, 45),
    'passing', 50 + mod(r.slot * 7, 45),
    'shooting', 50 + mod(r.slot * 13, 45)
  )
FROM _mega_teams t
JOIN _mega_roster r ON r.show_name = t.show_name
JOIN _mega_portraits portrait ON portrait.slot = r.slot
ON CONFLICT (id) DO NOTHING;

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
  status, date, venue, division, scorers, assists, own_goals,
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
  m.division,
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

-- Two freshers team-builder registrations, both using The Bear teams.
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
    'Cartwright',
    md5('mega-team:freshers:BEEF')::uuid
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000004',
    'Sydney',
    md5('mega-team:freshers:EVER')::uuid
  );

INSERT INTO public.team_registrations (id, captain_id, team_name, division, team_id)
SELECT id, captain_id, team_name, 'freshers', team_id
FROM _mega_registrations
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (
  id, registration_id, name, email, position, first_name, last_name,
  jersey_number, image_url, overall_rating, attributes
)
SELECT
  md5('mega-member:' || reg.id::text || ':' || roster.slot)::uuid,
  reg.id,
  roster.first_name || ' ' || roster.last_name,
  NULL,
  roster.position,
  roster.first_name,
  roster.last_name,
  roster.slot,
  portrait.image_url,
  55 + mod(roster.slot * 11, 40),
  jsonb_build_object('pace', 50 + roster.slot * 4, 'passing', 55 + roster.slot * 3)
FROM _mega_registrations reg
JOIN _mega_teams team ON team.id = reg.team_id
JOIN _mega_roster roster ON roster.show_name = team.show_name
JOIN _mega_portraits portrait ON portrait.slot = roster.slot
ON CONFLICT (id) DO NOTHING;

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

-- Polls: this schema accepts mens, womens, and both (not freshers).
CREATE TEMP TABLE _mega_poll_defs (
  poll_no integer PRIMARY KEY,
  division text NOT NULL,
  question_text text NOT NULL
) ON COMMIT DROP;

INSERT INTO _mega_poll_defs VALUES
  (1, 'mens', 'Which mens fixture should be highlighted?'),
  (2, 'mens', 'Which team has the strongest form?'),
  (3, 'womens', 'Which womens fixture should be highlighted?'),
  (4, 'womens', 'Which team has the strongest form?'),
  (5, 'both', 'Which fixture should be scheduled first?'),
  (6, 'both', 'Which match should be featured next?');

INSERT INTO public.polls (id, question_text, is_active, division)
SELECT md5('mega-poll:' || poll_no)::uuid, question_text, true, division
FROM _mega_poll_defs
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.poll_options (id, poll_id, option_text, vote_count)
SELECT
  md5('mega-poll-option:' || p.poll_no || ':' || o.option_no)::uuid,
  md5('mega-poll:' || p.poll_no)::uuid,
  o.option_text,
  mod(p.poll_no * 3 + o.option_no * 2, 17)
FROM _mega_poll_defs p
CROSS JOIN (VALUES
  (1, 'The Beef'),
  (2, 'Slough House'),
  (3, 'Falcone Family'),
  (4, 'Regent''s Park')
) AS o(option_no, option_text)
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

-- Divisions and seasons come from the legacy rows above through the same idempotent backfill the migration
-- runs on hosted data (docs/decisions/D-01-division-season-mapping.md). Re-seeding changes nothing.
SELECT public.backfill_legacy_divisions();

COMMIT;

# Local seed fixtures (SL-011)

The seed (`backend/supabase/seed.sql`) is applied automatically by `supabase db reset --local` after the baseline migration. It targets only this project's local database (`127.0.0.1:54322`); see [`local-development.md`](local-development.md).

```bash
cd backend
pnpm exec supabase status            # confirm 127.0.0.1:54322 first
pnpm exec supabase db reset --local  # migrations + seed (replaces local rows)
pnpm exec supabase test db --local   # runs tests/database/*.test.sql (pgTAP)
```

## Expected fixture rows

| Area | Rows |
|---|---|
| Divisions (legacy strings) | `mens` = Slow Horses, `womens` = The Penguin, `freshers` = The Bear; 8 teams each (24), 8 players per team (192) |
| Matches | 56 per division (168): 40 completed, 1 live, 15 scheduled; 446 goals with assists/own goals; JSON scorer fields mirror `goals` |
| Users | 50 accounts: `lamb@` (dictator), `river@` and `sydney@` (captains, each assigned to a team entry), `diana@` (editor) and 46 `fanNN@` default accounts for leaderboard/pagination volume |
| Registrations | 2 Freshers team-builder registrations with 16 members |
| Predictions | 672 division predictions; World Cup fantasy: 16 teams, 64 players, 40 matches, 160 predictions, group/knockout/award picks, 50 leaderboard rows |
| Content | 24 news articles (the unused polls feature was removed in `20261122000000`) |

Every table in the current schema receives rows. Tables for the target model (divisions/seasons, match events, lineups, etc.) do not exist yet and are seeded when their migrations land (Phase 2).

## Determinism

IDs are fixed or derived with `md5()` from stable keys, and statistics use `hashtext()` rather than `random()`. Only timestamps are relative to `now()` (so there is always a live match and upcoming fixtures). Two consecutive resets produce identical rows apart from those timestamps.

## Running the seed again (refresh)

The seed is safe to run again on a database that already has it, locally or on the Preview project: fixed ids and `ON CONFLICT` mean no row is ever duplicated. A rerun also refreshes the time-dependent `matches` columns (status, date, score, minute, timer) so the live match and upcoming fixtures are current again; every other table keeps `DO NOTHING`, so your edits to teams, players and so on are kept. The deploy workflow proves this on every run (`verify` job), and `scripts/sql/verify-preview.sql` is the read-only check of the result.

## Accounts and sign-in

Seed accounts have **no password** (`encrypted_password = ''`), so they cannot sign in. This is the documented non-login fixture approach; no credentials are in the browser bundle. To act as a fixture user locally, create a real local sign-in through Supabase Studio (`http://127.0.0.1:54323`) or Inbucket mail (`http://127.0.0.1:54324`), then adjust that user's role locally.

Accounts you create locally (for example by signing in) are not part of the seed. The database tests identify seed accounts by their addresses (`lamb@`, `river@`, `diana@`, `sydney@`, `fanNN@`), so your own accounts do not make them fail. A `db reset` removes them, since it rebuilds the local database from the migrations and seed.

## Media

All images (team logos, player portraits, news, World Cup logos) are generated offline SVG data URIs (`pg_temp.placeholder_svg`). No third-party image host or production R2 bucket is used.

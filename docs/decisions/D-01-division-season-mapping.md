# D-01: Mapping legacy division values and history to divisions and seasons

**Status:** Resolved by the owner on 2026-11-18. Applies to the division and season model (SL-020). It refines the mapping table in `SL-004-migration-and-cutover-strategy.md` §2.

## Decision

1. **One initial season per populated division.** A legacy value is *populated* when at least one team, match or team registration carries it. All of that value's existing data goes into that single season and is never split.
2. **The season name is the competition year taken from the match dates:**
   - `2026` when the first and last match fall in the same calendar year;
   - `2025–26` (an en dash with a two-digit end year) when they span two consecutive years;
   - `2024–2026` (full years) for a longer span, which is not expected.

   A dictator can rename any season later.
3. **Season dates:** `starts_on` is the date of the first match and `ends_on` the date of the last.
4. **No matches** (teams or registrations only): the dates stay NULL. The name is the year of the earliest `team_registrations.created_at`, or the year the backfill runs if there is no registration.
5. **Status:** the initial season is `active`, `public` and `is_current`.

## Value mapping

| Legacy value | Division slug | Division name | Notes |
|---|---|---|---|
| `mens` | `super-league` | Super League | Matches the current `/super-league` route |
| `womens` | `wsl` | WSL | Matches `/wsl` |
| `freshers` | `freshers` | Freshers | Matches `/freshers` |
| `inter` (matches only) | none | none | Inter has not started. No division is created; any such row is reported as an anomaly by `division_model_drift()` |
| `polls.division` (`both`) | not mapped here | | Polls → divisions belongs to the home configuration work (SL-060) |

These slugs and names are only the initial data. Nothing in the schema or code depends on them: divisions have no enum and no value-list constraint.

## How it is applied

- `public.backfill_legacy_divisions()` is idempotent. The migration calls it to backfill existing hosted data, and `seed.sql` calls it after the synthetic legacy rows are inserted, so local, staging and production all run the same code.
- `public.legacy_division_map` records the value → division → season mapping. It exists only for the expand period and is removed with the legacy columns (SL-102).
- While legacy writers still exist, triggers fill whichever side of a row is missing (`division` ↔ `season_id`), and `public.division_model_drift()` must return no rows.

## Contract (owner instruction 2026-11-19)

Production has only Super League, WSL and Freshers, and all their data belongs to 2026. After every reader and writer was ported, `20261122000000_retire_legacy_division_paths.sql` removed the legacy strings, the map, the triggers and the backfill. On a database that still holds legacy rows (production), the migrations run in order: `20261119000000` backfills, `20261121000000` copies flairs, and `20261122000000` drops the old paths, but only after its guards confirm that every match and registration has a season, the drift report is empty, every flair was copied, and polls hold no real data. Otherwise it stops and changes nothing. `public.season_label` is kept. New seasons are created by dictators, and the seed inserts divisions and seasons directly.

## Season or division (owner instruction 2026-11-19)

All division data belongs to a season unless it describes the division itself or a person. Existing production records are all 2026 data, so they join the 2026 season of their division.

| Data | Scope | Where |
|---|---|---|
| Team participation | Season | `team_entries` (a team joins a season of its division) |
| Player roster | Season | `players.team_entry_id`; every existing player is on its team's 2026 entry (`20261123000000`) |
| Registration roster (Freshers team builder) and captain | Season | `team_registrations.season_id`, with `team_members` through their registration |
| Matches, goals, own goals, assists, scorer JSON | Season | `matches.season_id` |
| Standings, form, top scorers and assisters | Season | Computed from that season's matches (`season_player_stats`) |
| Fantasy predictions | Season | Through their match |
| Fantasy points and leaderboard | Season | `season_fantasy_points` and `season_fantasy_leaderboard()`; `user_profiles.points` is removed |
| Sections, navigation, format, rules text | Season | `season_sections`, `seasons.format`, `seasons.rules_md` |
| Division identity, branding, order | Division | `divisions` |
| Team identity (name, logo, colour) | Division-wide | `teams`: one club identity across seasons; only participation is per season |
| Supporter flair | Division | `division_flairs`: a fan supports a club in a division |
| Legends | All time | Every season added up |
| Newsletter | Global | Editorial content; home placement is SL-060 |
| Accounts, profiles, roles | Global | Unchanged |
| World Cup fantasy | Separate | `wc_*`, `wc_team_flair`, `/wc`: untouched |

**Fantasy points migration (owner decision):** the season totals are the sums of `points_awarded`, exactly what grading wrote into `user_profiles.points`. Before that column is dropped, the migration compares it with the sums for every real account and stops, changing nothing, on any difference (for example a manual edit). The owner then resolves each case. The synthetic seed accounts are not compared.

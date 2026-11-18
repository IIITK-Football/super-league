# D-08 proposal: authoritative score and goal events

Status: **proposal, open**. The owner resolves D-08 and records the answers; it unblocks SL-022. Drafted 2026-11-18 from the code at that date.

## 1. Today's behavior

The score and the goals are separate counters, and nothing reconciles them.

- **Adding a goal** (`backend/app/api/admin/matches/live/route.ts:73-110`):
  - It reads the match, adds 1 to `home_score`/`away_score` in memory (an own goal counts for the other side), appends to the JSON `scorers`/`own_goals`/`assists`, inserts a `goals` row without checking the error, then writes the match.
  - This read-modify-write has no transaction, so two concurrent taps can lose a goal.
  - A `player_id` is required, so an unknown scorer cannot be recorded.
- **`add_assist`** (112-117) appends to the JSON only. **Deleting a goal** (149-195) subtracts with `Math.max(0, …)`, which hides drift. `edit_goal` returns 501.
- **Manual score edit:** `backend/app/api/matches/update/route.ts` sets `home_score`/`away_score`/`status` directly after only a sign-in check, and nothing in the frontend calls it. The baseline RLS policy "Allow authenticated updates on matches" (`USING (true)`) also lets any signed-in user write scores through the Data API.
- **Walkovers:** `admin/matches` POST creates a completed 3–0 match with no events.
- **Penalties** are stored separately in `home_penalties`/`away_penalties`.
- **Readers:**
  - standings and the home dashboard read the score columns;
  - grading and regrade read the score columns for the scoreline, and the JSON scorers and assists for player points;
  - `season_player_stats` takes the greater of `goals` rows and JSON entries per match and player.
- **Grading** sets `points_awarded` rather than adding to it, so repeating it changes nothing, but nothing marks a corrected match for regrading.
- **Audit:** `audit_matches` and `audit_goals` already record score and goal changes.
- **Data:** the local seed has no mismatches. Production probably has Freshers matches whose goals exist only in the JSON.

## 2. Options

| Criterion | A: derived only | B: manual score wins | C: events plus audited override and mismatch flag | **D: derived only, with unknown-scorer events and an awarded result** |
|---|---|---|---|---|
| Phone: instant score with an unknown scorer | Fails without unknown events | Yes | Yes | Yes ("+1 Home" adds an unattributed goal) |
| Correction safety | Good | Poor (silent drift) | Medium (two truths until resolved) | Good (a correction is an event edit) |
| Standings and grading determinism | Good | Scorer points drift | Readers must choose | One source |
| Idempotent regrade | Yes | Yes | Depends on the override | Yes |
| Offline sync (SL-050) | Inserts commute | "Set 2–1": last writer wins, data lost | Override conflicts with events | Inserts with client ids commute |
| Walkover or forfeit | Not expressible | Yes | Through the override | Explicit `result_kind` |

C keeps a permanent second source of truth that every reader has to interpret, which CLAUDE.md asks to avoid. D completes A: the mismatch that C flags cannot exist, and "2 goals unattributed" is a normal, visible state.

## 3. Recommendation: D

**Data shape (SL-022):**
- `match_events`: `id uuid` (client-generated, for idempotency), `match_id`, `kind` in `goal`/`own_goal`/`yellow`/`red`, `team_id`, nullable `player_id` and `assist_player_id`, `minute`, `version`, `created_by`, `voided_at`/`voided_by` (soft removal, so a replayed edit of a removed event becomes a visible conflict).
- A goal with `player_id IS NULL` is an **unattributed goal**: it counts toward the score but toward no player's statistics.
- Constraints: no assist on an own goal; the assister is never the scorer; a trigger refuses a team not in the match and a player without a roster place on that team in the match's season. The audit trigger is attached.
- `matches.result_kind` in `played`/`walkover`/`forfeit` (default `played`), with `result_reason` required otherwise.
- Penalties stay as two totals and are never goal events.

**Invariant:**
- For a played match, `home_score` = non-voided home goals + away own goals, and the same for away.
- For an awarded result, there are no goal events and the score is the awarded one.
- The score columns stay as a cache, because readers and realtime subscriptions use them. Their only writer is a trigger on `match_events` in the same transaction. A guard refuses any other score write, and column UPDATE on the score is revoked from signed-in users.

**Score-only edits:**
- **+1** adds an unattributed goal.
- **−1** voids the latest unattributed goal for that side; if there is none, the scorer chooses which goal to remove.
- **"Set to 2–1"** in the UI becomes those steps on the client. The API never accepts an absolute score for a played match, so offline replays cannot overwrite each other.
- The workspace shows "N goals unattributed" until each one is attributed.

**Readers:**
- Standings read the score columns.
- Grading reads the score columns for the scoreline, and attributed goal events (excluding own goals) for scorer and assist points.
- Every event change increments `matches.events_version`. Grading records the version it graded; a completed match whose version moves on is shown as "needs regrade", and regrading overwrites `points_awarded`.
- Grading should be restricted to dictators (it has no role check today; see SL-025).

**Migration (report, do not fix):**
1. Build events from `goals` rows.
2. Add JSON-only goals as attributed events, by the same per-player rule as `season_player_stats`.
3. Add any remaining score surplus as unattributed events tagged as from the migration.
4. Put completed matches with a score but no goals on a review list as walkover candidates.
5. Stop on blockers: more goal rows than score, or a goal for a team not in the match.

The owner runs this read-only dry run on a **local restore** of production, never against hosted:

```sql
WITH r AS (
  SELECT m.id,
    count(g.id) FILTER (WHERE (g.team_id = m.home_team_id) <> g.is_own_goal AND g.team_id IN (m.home_team_id, m.away_team_id)) AS home_rows,
    count(g.id) FILTER (WHERE (g.team_id = m.away_team_id) <> g.is_own_goal AND g.team_id IN (m.home_team_id, m.away_team_id)) AS away_rows,
    count(g.id) FILTER (WHERE g.team_id IS NULL OR g.team_id NOT IN (m.home_team_id, m.away_team_id)) AS orphan_rows
  FROM public.matches m LEFT JOIN public.goals g ON g.match_id = m.id GROUP BY m.id)
SELECT m.id, s.slug AS season, m.status, m.home_score, m.away_score, r.home_rows, r.away_rows, r.orphan_rows,
  jsonb_array_length(COALESCE(m.scorers, '[]')) AS json_scorers,
  jsonb_array_length(COALESCE(m.own_goals, '[]')) AS json_own_goals,
  CASE WHEN r.orphan_rows > 0 THEN 'blocker: goal for a team not in the match'
       WHEN COALESCE(m.home_score,0) < r.home_rows OR COALESCE(m.away_score,0) < r.away_rows THEN 'blocker: more goal rows than score'
       WHEN r.home_rows + r.away_rows = 0 AND m.status IN ('completed','forfeited') THEN 'review: awarded result or unrecorded goals'
       ELSE 'unattributed surplus (after JSON-only goals)' END AS outcome
FROM public.matches m JOIN r ON r.id = m.id LEFT JOIN public.seasons s ON s.id = m.season_id
WHERE COALESCE(m.home_score,0) <> r.home_rows OR COALESCE(m.away_score,0) <> r.away_rows OR r.orphan_rows > 0
ORDER BY outcome, season;
```

## 4. Questions for the owner

1. Adopt D: the score always comes from events, and a manual score edit becomes unattributed goal events? **Default: yes.**
2. Record walkovers and forfeits as an explicit `result_kind` with an awarded score and a required reason? **Default: yes, a 3–0 award.**
3. When −1 has no unattributed goal to remove, must the scorer pick which goal to remove? **Default: yes.**
4. Should migration surplus become unattributed events, or stay blocked until a person reviews it? **Default: create them, tagged, and list them in the report.**
5. After a correction, regrade automatically, or only flag the match "needs regrade" for a dictator? **Default: flag only.**
6. Keep cards out of the score and fantasy until there is a rule for them? **Default: yes.**
7. Keep penalty shootouts as two totals rather than events? **Default: totals only.**

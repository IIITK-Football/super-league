# SL-004 — Migration map and cutover strategy

**Status:** Draft for review (Phase 0 decision record). Must be approved before the first domain-model migration (SL-020).

## 1. Baseline facts

- Active chain: `backend/supabase/migrations/20261106000000_baseline.sql` (20 tables, 3 views, 10 functions, 44 policies); `20261106180125_harden_roles_and_rpc.sql` is empty (placeholder for SL-024/025). Archive: `migrations_legacy/001–035` (reference only, not applied). Local seed: `backend/supabase/seed.sql`.
- Supabase stays DB + auth behind Workers.
- `freshers_fixtures` exists only in archived `030`; the frontend (`RoadToFinal.jsx`, `ManageRoadToFinal.jsx`) still queries it. **Hosted contents of this table are unknown** and must be checked read-only by the user/owner before SL-102 retires it.

## 2. Data to retain and mapping

| Legacy | Target | Notes / unsupported or duplicate |
|---|---|---|
| `teams.division` (`mens/womens/freshers`) | `divisions` rows + `team_entries.season_id` | Create one division per value; one initial season each (e.g. "2026"). `teams` becomes a reusable club identity; name/logo/colour retained. |
| `matches.division` (adds `inter`) | `matches.season_id/phase_id` | `inter` has no division; **needs owner decision**: own division or archive. Flag rows during dry-run. |
| `polls.division` (`both`) | poll → division(s) join | `both` = linked to men's+women's. |
| `team_registrations` (+`division`, `captain_id`, `team_id`) | `team_entries` + captain assignment | Preserves captain→team link. |
| `players` (team-bound) | `persons` + `roster_memberships` | `players.team_id` → membership for the initial season. |
| `team_members` (Freshers registration roster) | `persons` + `roster_memberships` | **Duplicate concept with `players`**; dedupe by email, else by normalized name+team; ambiguous rows listed for manual review, never auto-merged silently. |
| `players.assists` integer | derived from events | Drop after reconcile; compare to `goals` counts first. |
| `goals` | `match_events` (goal/own_goal + assist) | Canonical source. |
| `matches.scorers/assists/own_goals` JSON | `match_events` | **Parallel duplicate** of `goals`. Reconcile per match: where JSON and `goals` disagree, produce a discrepancy report; owner picks winner (default: `goals` rows, JSON used to fill missing attribution). Keep JSON columns until verified, then retire (SL-102). |
| `matches.home_score/away_score/penalties/status/minute/timer_*` | retained on match | Authority rule when score ≠ events is a Phase 2 open item (backlog §5). |
| `user_roles` (`default/editor/captain/dictator/admin`) | four roles + assignments | `default→user`, `captain→captain` (+ assignment from `team_registrations`), `dictator→dictator`. **`admin` and `editor`: owner must list who holds them** and decide scorer vs dictator per person; no blanket auto-mapping. |
| `user_profiles` (`mens_team_flair`, `womens_team_flair`, `wc_team_flair`, `points`) | profile + per-division fantasy profile + WC profile | `points` is derived; recompute and compare. |
| `predictions` | prediction scoped to season via match | Retained as-is; FK to match unchanged. |
| `wc_*` (10 tables) | unchanged | Separate domain; no division/season columns. |
| `newsletter`, `poll_options` | unchanged | Reused by home config (SL-060). |

Orphans/unsupported to report in dry-run: matches with null team ids, players with null `team_id`, goals with null `player_id`, remote stock image URLs in seed (non-production), R2 media URLs (kept untouched until SL-073).

## 3. Rules for every domain migration

1. Additive first: new tables/columns and backfill; old columns stay until parity verified (expand → migrate → contract; the contract step is SL-102).
2. Each migration is an ordered CLI migration, reproducible from empty local DB + seed; the seed is updated in the same change.
3. Backfills are idempotent and wrapped in transactions; each ships with a verification query (row counts old vs new, discrepancy report).
4. No `DROP`/`TRUNCATE` of tables holding retained data in the same release as its replacement.
5. Local first: every migration proven on a fresh local reset **and** on a local copy loaded with a sanitized production-shaped dump, if the owner supplies one.

## 4. Environments and release targets

| Target | Database | Who may mutate | How |
|---|---|---|---|
| **local** | local Supabase, 127.0.0.1:54322 | developer | `supabase db reset --local` / `migration up --local` (see `docs/local-development.md`) |
| **develop** | a separate hosted Supabase project/branch for `develop.super-league.pages.dev` | CI on merge to `develop`, after review | automated migration workflow (SL-080) |
| **production** | the hosted project currently linked in this checkout | CI only on approved release, by a dictator/owner | protected environment + manual approval (SL-080/101) |

Owner to confirm: whether a separate develop project exists (README names a develop site; current link is a single project `Super League`). Until confirmed, **no hosted migration is run by anyone from a laptop**, and nothing in this plan connects to hosted.

## 5. Rollback and forward-repair policy

- **Forward-repair is the default.** Applied migrations are never edited. A defect is fixed by a new migration.
- **Before** any production migration: verified backup/PITR point recorded (owner action), dry-run report attached to the release, maintenance expectations stated.
- Because releases are expand-only until SL-102, rolling back application code to the previous version stays safe: old columns/tables still exist and are still written until contract.
- Destructive contract steps (SL-102) require: adoption verified, rollback window elapsed, archive retained, separate reviewable commit.
- Data fixes found after release are idempotent SQL in a new migration, tested locally first.

## 6. Staged release order

1. Local proof (reset + seed + tests green). 2. develop deploy and parity checks. 3. Production expand migration + backfill during a quiet window. 4. Parity verification queries. 5. Switch consumers (Workers, then frontend). 6. Hold window. 7. Contract/retire (SL-102). Each stage needs explicit owner approval; nothing is deployed by Claude.

## 7. Open items for the owner

`inter` division handling; who holds `admin`/`editor`; whether a develop Supabase project exists; whether hosted `freshers_fixtures` has data; whether to supply a sanitized prod-shaped dump.

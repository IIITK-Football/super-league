# SL-004 — Migration map and cutover strategy

**Status:** Approved by owner 2026-11-16 (Phase 0 decision record). Must be approved before the first domain-model migration (SL-020).

## 1. Baseline facts

- Active chain: `backend/supabase/migrations/20261106000000_baseline.sql` (20 tables, 3 views, 10 functions, 44 policies); `20261106180125_harden_roles_and_rpc.sql` is empty (placeholder for SL-024/025). Archive: `migrations_legacy/001–035` (reference only, not applied). Local seed: `backend/supabase/seed.sql`.
- Supabase stays DB + auth behind Workers.
- `freshers_fixtures` exists only in archived `030`. Owner checked the hosted Supabase dashboard and found **no such table**; it is treated as absent from the hosted schema and **nothing is migrated from it**. The frontend (`RoadToFinal.jsx`, `ManageRoadToFinal.jsx`) still queries it; that runtime dependency is removed during registration/frontend consolidation (SL-045 registration, SL-091 division/season frontend), not in SL-054 bracket logic; final retirement check in SL-102. No hosted re-check is made.

## 2. Data to retain and mapping

| Legacy | Target | Notes / unsupported or duplicate |
|---|---|---|
| `teams.division` (`mens/womens/freshers`) | `divisions` rows + `team_entries.season_id` | Create one division record per value that has data; one initial season each (e.g. "2026"). Divisions are ordinary data records (no enum). `teams` becomes a reusable club identity; name/logo/colour retained. |
| `matches.division` (check constraint also allows `inter`) | `matches.season_id/phase_id` | Inter has not started and has no data to preserve: **no Inter division is created**. The dry-run asserts zero `inter` rows; any found is reported as an anomaly, not mapped. A dictator can create Inter later. |
| `polls.division` (`both`) | poll → division(s) join | `both` = linked to men's+women's. |
| `team_registrations` (+`division`, `captain_id`, `team_id`) | `team_entries` + captain assignment | Preserves captain→team link. |
| `players` (team-bound) | `persons` + `roster_memberships` | `players.team_id` → membership for the initial season. |
| `team_members` (Freshers registration roster) | `persons` + `roster_memberships` | **Duplicate concept with `players`**; dedupe by email, else by normalized name+team; ambiguous rows listed for manual review, never auto-merged silently. |
| `players.assists` integer | derived from events | Drop after reconcile; compare to `goals` counts first. |
| `goals` | `match_events` (goal/own_goal + assist) | Canonical source. |
| `matches.scorers/assists/own_goals` JSON | `match_events` | **Parallel duplicate** of `goals`. Reconcile per match: where JSON and `goals` disagree, produce a discrepancy report; owner picks winner (default: `goals` rows, JSON used to fill missing attribution). Keep JSON columns until verified, then retire (SL-102). |
| `matches.home_score/away_score/penalties/status/minute/timer_*` | retained on match | Authority rule when score ≠ events is a Phase 2 open item (backlog §5). |
| `user_roles` (`default/editor/captain/dictator/admin`) | five roles + assignments | `default→user`, `captain→captain` (+ assignment from `team_registrations`), `dictator→dictator`, **`editor→editor` (newsletter-only, preserved)**. **`admin` → user with no elevated access** unless a reviewed per-person assignment is recorded **before** migration; never auto-mapped to scorer or dictator (see §3a and SL-003). |
| `user_profiles` (`mens_team_flair`, `womens_team_flair`, `wc_team_flair`, `points`) | profile + per-division fantasy profile + WC profile | `points` is derived; recompute and compare. |
| `predictions` | prediction scoped to season via match | Retained as-is; FK to match unchanged. |
| `wc_*` (10 tables) | unchanged | Separate domain; no division/season columns. |
| `newsletter`, `poll_options` | unchanged | Reused by home config (SL-060). |

Orphans/unsupported to report in dry-run: matches with null team ids, players with null `team_id`, goals with null `player_id`, remote stock image URLs in seed (non-production), R2 media URLs (kept untouched until SL-073).

**Division mapping applied (2026-11-19):** the `teams`, `matches` and `team_registrations` rows above are mapped by `public.backfill_legacy_divisions()` in `20261119000000_divisions_and_seasons.sql` (one initial season per populated value, D-01). `polls.division` and the flair columns are not mapped yet (SL-060, SL-043). `public.division_model_drift()` is the parity query: it must return nothing except reported anomalies (an `inter` value, a row without a division).

## 3. Rules for every domain migration

1. Additive first: new tables/columns and backfill; old columns stay until parity verified (expand → migrate → contract; the contract step is SL-102).
2. Each migration is an ordered CLI migration, reproducible from empty local DB + seed; the seed is updated in the same change.
3. Backfills are idempotent and wrapped in transactions; each ships with a verification query (row counts old vs new, discrepancy report).
4. No `DROP`/`TRUNCATE` of tables holding retained data in the same release as its replacement.
5. Local first: every migration proven on a fresh local reset **and** on a local copy loaded with a sanitized production-shaped dump, if the owner supplies one.

## 3a. Legacy-admin review (local-only, read-only)

Run only against the local database (port 54322) to list legacy admins needing an explicit decision:

```sql
-- read-only; run via: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
SELECT ur.user_id, up.email, up.real_name, ur.role
FROM public.user_roles ur
LEFT JOIN public.user_profiles up ON up.id = ur.user_id
WHERE ur.role = 'admin'
ORDER BY up.email;
```

The output stays local (git-ignored), is never committed, and is never run against hosted. The owner reviews the list and records scorer, dictator, or nothing per person **before** the role migration runs (the migration reads that reviewed mapping; unlisted admins become user). The reviewed list is kept only on the owner's machine, outside the repository.

## 4. Environments and release targets

| Target | Database | Who may mutate | How |
|---|---|---|---|
| **local** | local Supabase, 127.0.0.1:54322 | developer | `supabase db reset --local` / `migration up --local` (see `docs/local-development.md`) |
| **staging** (for the `develop` branch) | a separate hosted Supabase project, **being created by the owner** (not yet confirmed); synthetic data only | GitHub Actions on push to `develop`, environment `Database Preview` | `db push --include-seed` through `.github/workflows/db-deploy.yml`; see `docs/release.md` |
| **production** | the original hosted project (`Super League`) | GitHub Actions on push to `main`, environment `Database Production`, required reviewer | `db push` only, never seeded. Production has **no migration history** (`schema_migrations` does not exist): the baseline is marked applied, never run, after a schema comparison (see `docs/release.md`) |

Staging is created **empty** and filled by CI. No hosted migration is run by anyone from a laptop, and the local CLI link points at staging, not production. Staged verification of the auth work uses the staging project, with the production export gate before the first production run.

## 5. Rollback and forward-repair policy

- **Forward-repair is the default.** Applied migrations are never edited. A defect is fixed by a new migration.
- **Before** any production migration: verified backup/PITR point recorded (owner action), dry-run report attached to the release, maintenance expectations stated.
- Because releases are expand-only until SL-102, rolling back application code to the previous version stays safe: old columns/tables still exist and are still written until contract.
- Destructive contract steps (SL-102) require: adoption verified, rollback window elapsed, archive retained, separate reviewable commit.
- Data fixes found after release are idempotent SQL in a new migration, tested locally first.

## 6. Staged release order

1. Local proof (reset + seed + tests green). 2. Staging deploy from `develop` (CI) and parity checks. 3. Production expand migration + backfill during a quiet window. 4. Parity verification queries. 5. Switch consumers (Workers, then frontend). 6. Hold window. 7. Contract/retire (SL-102). Each stage needs explicit owner approval; nothing is deployed by Claude.

## 7. Open items for the owner

- Creating the staging Supabase project and the GitHub environments (steps in `docs/release.md`); this record should then be updated to confirm they exist.
- Whether to supply a sanitized production-shaped dump for local rehearsal.
- Per-person decision for each legacy `admin` (from the local-only review list), recorded before the role migration runs. This is a gate for the SL-024 role migration.

Resolved 2026-11-16: `inter` (no data, no division created), `editor` (preserved as editor), `freshers_fixtures` (absent on hosted).

**Owner exception to §3 rule 4 (2026-11-19):** the contract step for divisions ships in the same release as the expand step (`20261119000000` → `20261122000000`), instead of waiting for SL-102. The owner stated that production has only the three divisions, with 2026 data, and that `polls`, `poll_options` and `league_schedule` are empty. The contract migration enforces both statements as guards: it refuses to run unless every record survives and polls hold no real data. Release order is unchanged: local, then staging, then a reviewed `main` release with a backup or PITR point first.

**Backlog restructure (owner instruction 2026-11-18):** the unfinished backlog is now organised as end-to-end feature slices (`backlog/phases.md`, `backlog/superseded.json`). The SL-020 exception above becomes the rule:
- Each slice ports every known caller and then runs its own contract step, behind guards that stop unless every record survives.
- The slice owners are SL-021 (`players` + `team_members` → identity and roster memberships), SL-024 (`team_registrations` and `user_roles`) and SL-022 (`goals` and the match JSON → match events).
- SL-102 is now the final post-cutover sweep for any compatibility deliberately kept for the rollback window.

The release order is unchanged: local, then staging, then a reviewed `main` release with a backup or PITR point first, with each production step approved by the owner. R2 media (§2, last orphan line) are migrated in Phase 3 (SL-073), bucket by bucket, after the Worker runtime exists.

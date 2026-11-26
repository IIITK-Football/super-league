# Current checkpoint

The live relay checkpoint shared by Claude (main checkout, `develop`) and Codex (`../super-league-codex`,
`codex/work`). The agent that stops rewrites this file last, after committing its work. See `AGENTS.md` for the
handoff steps.

## Status

- **Updated:** 2026-11-26 by Claude.
- **Phase 3 complete:** SL-030 (`91d8cc9`), SL-031 (`e6cfab3`) and SL-032 (`e68f080`) are done.
- **Release readiness:** the strict rules pass against `main` (168 files) and every test group passes locally.
- **Release PR:** not opened. Opening a PR into `main` needs the owner's explicit go-ahead; the owner merges it.

## Done (all pushed to `develop`)

- `fdb78b3`: client factories (`backend/lib/supabase/clients.ts`) with timeouts, an idempotent-read retry, round counting and `Server-Timing`. Every served handler builds its clients through them.
- `99a22d6`: captain and dictator team details go through `team_details_for_edit` and `captain_update_team_details` (migration `20261205000000`) as the caller. The audit actor is tested, and the route no longer uses the secret key.
- `5991490`: World Cup team list and saved-bracket read use the publishable key, with parity tests. Closed submissions no longer write. Four archive reads are owner-approved exceptions.
- `a92f094`: `create_awarded_match` (migration `20261205000001`) creates and awards a match in one transaction, with a rollback test.
- `05f6a28`: an expired token now answers 401, where it used to answer 500. Database refusals map to 403, 400, 404 or 409, and a 500 gives a fixed message. Worker tests cover tokens, refusals, the actor and rollback.
- `d622763`, `0b06082`: `pnpm --dir api verify:local` passes 11 of 11 checks through real `wrangler dev`; evidence is in `docs/walkthroughs/evidence/SL-030-local-worker.json`. Bundle and config key scans added.
- `fe99954`: `/api/health` reports the commit and Worker version.
- `e60da4b`: `node scripts/staging-worker-probe.mjs` gathers read-only staging evidence: release, scoped read and timings.
- `882a3eb`: every active GET route stays within 3 rounds (`api/test/route-rounds.test.ts`). Standings, the fantasy leaderboard and the dictator match list were fixed.
- First staging smoke at `fe99954`: health showed environment `staging`, the commit and the version. Timings: standings wall median 9.9 s against a Worker total of about 0.9 s; dashboard wall 1.8 s against a Worker total of 1.1 s; Data API rounds about 250 ms each.

## Exact next step

1. **Release PR, on the owner's go-ahead:** `develop` → `main`, merged with a merge commit by the owner. Production migrations then wait for a fresh verified backup (Actions → Database backup) and the owner's approval of `Database Production`. Five migrations go to production after `20261130000007`; they are listed in the release notes.
2. **Optional, owner:** restore staging's seeded fantasy points with `~/sl-owner-sql/1-…DRYRUN.sql`, then `2-…sql`, after confirming the address shows `yecozsiccsfwphlmxozt`. Two early SL-032 runs regraded them.
3. **Next phase (4):** SL-040, division and season configuration, then SL-044.

**Found in the final full run and fixed (`fix(api): never publish an editor's email…`):**
- Article bylines stored the publisher's email. The route now uses the display name.
- Migration `20261205000003` scrubs existing email bylines with the audit trigger paused, and adds a check constraint.
- Staging's append-only audit history keeps the synthetic `sl-check-…` addresses from the earlier parity runs. They are test accounts, not people.

## In flight

Nothing uncommitted.

## Local database

Rebuilt on 2026-11-26 with `bash scripts/local-db.sh reset --yes`; migrations are applied through `20261205000001`. Note: the guard blocks `supabase migration up`, so use the reset helper after adding a migration.

## Not migrated on purpose

`auth/login`, `legends` and `admin/teams` still build clients directly. The Worker does not serve them; they are Next-only and are retired by SL-034.

## Contributor prototypes to read when their item comes up

- #185 → SL-050 phone scorer.
- #186 → SL-053 lineups.
- #187 → SL-090 design system.

## Order after SL-030

1. SL-031 → SL-032.
2. SL-040 → SL-044.
3. SL-045.
4. SL-050, SL-054.
5. SL-053, SL-108.
6. Phase 8: SL-104, SL-043, storage (SL-070 → SL-071 → SL-105 → SL-072 → SL-106), SL-060, SL-061.
7. Phase 9, then Phase 10.

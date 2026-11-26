# Current checkpoint

The live relay checkpoint shared by Claude (main checkout, `develop`) and Codex (`../super-league-codex`,
`codex/work`). The agent that stops rewrites this file last, after committing its work. See `AGENTS.md` for the
handoff steps.

## Status

- **Updated:** 2026-11-26 by Claude.
- **Active item:** SL-030 (Phase 3), started with `pnpm work start` in `5e89361`.
- **Plan:** `docs/plans/SL-030.md` and the approved session plan summarized below. Decisions D-04 and D-05.
- **Owner answers (2026-11-26):**
  - World Cup secret-key reads: downscope where row-level security gives the same response; list any that cannot as owner exceptions.
  - Staging: Claude makes the read-only GETs on staging; the owner switches Smart Placement on or off when asked and attests C3.

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

Staging evidence and the placement decision are recorded in `docs/plans/SL-030.md` ("Staging evidence (2026-11-26)").
- Placement off: standings Worker median 462 ms; Smart Placement brought no gain, so it was reverted in `418deb9`.
- PR #192 was closed by the owner's decision: the release PR is opened only after the phase gate.
- Strict test rules pass locally against `main` (`5033fd0`).

1. The owner attests C3: `pnpm work attest SL-030 C3`.
2. `pnpm work done SL-030` runs the groups and writes the walkthrough skeleton. Fill in the walkthrough (summary, local evidence, staging evidence, open discrepancies from the plan) and run it again.
3. Then start SL-031 (same-origin `/api` routing evidence through Pages; rollback pair).

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

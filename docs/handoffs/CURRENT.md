# Current checkpoint

The live relay checkpoint shared by Claude (main checkout, `develop`) and Codex (`../super-league-codex`,
`codex/work`). The agent that stops rewrites this file last, after committing its work. See `AGENTS.md` for the
handoff steps.

## Status

- 2026-11-27: Claude holds the work, in the main checkout on `develop`.
- Phase 4 is active. SL-040 is done. SL-044 is in progress ([plan](../plans/SL-044.md)).
- Done for SL-044: migration `20261207000000_season_rules_versions.sql` and seed call, Worker routes, public Rules page, dictator editor, local walkthrough `scripts/ui-walkthrough/rules.mjs` (all four scenarios passed on `f06e1ed`).

## Verification

- Local reset applied the migration and demo seed on 54322; 621 pgTAP checks, 110 Worker tests, 270 frontend tests (20 local-only skipped) and both TypeScript checks passed.

## Exact next step

1. Push `develop`, then run `node scripts/ui-walkthrough/rules.mjs --target staging` once the staging database, Pages and Worker serve the new commit.
2. Only after it passes: add `20261207000001_retire_rules_md.sql` (drop `seasons.rules_md`, redefine `backfill_season_rules` without it, update `027_season_rules.test.sql` and `docs/decisions/D-01-division-season-mapping.md`), reset locally, test, push, walk through again.
3. Write `docs/walkthroughs/SL-044.md`, run `pnpm work done SL-044`; C1 is the owner's attestation.

## Local database

Local Supabase on 54322 runs the new migration and demo seed. No dev servers are left running.

## Not migrated on purpose

`auth/login`, `legends` and `admin/teams` still build clients directly. The Worker does not serve them; they are Next-only and are retired by SL-034.

## Contributor prototypes to read when their item comes up

- #185 → SL-050 phone scorer.
- #186 → SL-053 lineups.
- #187 → SL-090 design system.

## Remaining order

1. SL-044.
2. SL-045.
3. SL-050, SL-054.
4. SL-053, SL-108.
5. Phase 8: SL-104, SL-043, storage (SL-070 → SL-071 → SL-105 → SL-072 → SL-106), SL-060, SL-061.
6. Phase 9, then Phase 10.

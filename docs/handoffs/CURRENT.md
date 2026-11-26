# Current checkpoint

The live relay checkpoint shared by Claude (main checkout, `develop`) and Codex (`../super-league-codex`,
`codex/work`). The agent that stops rewrites this file last, after committing its work. See `AGENTS.md` for the
handoff steps.

## Status

- **Updated:** 2026-11-26 by Claude.
- **Phase 3 complete:** SL-030, SL-031 and SL-032 are done. The release PR is #193 (`develop` → `main`), awaiting the owner's merge, the production backup and the approval of `Database Production`.
- **Active:** Phase 4. SL-040 has its plan ([docs/plans/SL-040.md](../plans/SL-040.md)) but has not been started.
- **Owner decisions (2026-11-26):**
  - no standing release PR (one per phase);
  - SL-032 recorded its rollback pair without a new rollback.

## Exact next step

1. `pnpm work start SL-040`.
2. Implement the plan in order:
   - the migration `20261206000000_division_season_lifecycle.sql`;
   - the Worker routes under `backend/app/api/admin/{divisions,seasons}`;
   - section gating in `resolveScope`;
   - the public routes, navbar and section gate;
   - the `ManageDivisions.jsx` rework;
   - tests, then the walkthrough `scripts/ui-walkthrough/divisions.mjs` locally and on staging.
3. Commit each step separately. Rebuild the local database with `bash scripts/local-db.sh reset --yes` after adding the migration (the guard blocks `migration up`).
4. Then SL-044 (the versioned rules page).

**Reminders:**
- Run `pnpm exec tsc --noEmit` in `backend/` before pushing.
- The strict rules must pass against `main`: every changed file needs a changed test in a group that covers it.
- Parity tooling: `node scripts/parity/verify-parity.mjs --target local|staging` and `node scripts/ui-walkthrough/parity.mjs --target local|staging`.

**Optional, owner:** restore staging's seeded fantasy points with `~/sl-owner-sql/` (dry run first).

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

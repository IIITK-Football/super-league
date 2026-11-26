# Current checkpoint

The live relay checkpoint shared by Claude (main checkout, `develop`) and Codex (`../super-league-codex`,
`codex/work`). The agent that stops rewrites this file last, after committing its work. See `AGENTS.md` for the
handoff steps.

## Status

- Phase 3 merged in PR #193 at `af61b3f`. Both local branches were fast-forwarded to that release before SL-040.
- Phase 4 is active. SL-040 is in progress and C1 requires the local and staging walkthroughs and owner attestation.
- `d426640` implements the division and season lifecycle, the audited Worker routes, the dictator workspace, and data-driven public navigation and section gating. The new management routes live in the Worker so the existing API test group covers them.

- `6a6647e` fixes landing navigation cleanup. `e4f6112` keeps the selected season in the URL when the division has no current season.

## Verification

- The guarded local reset applied `20261206000000_division_season_lifecycle.sql` and the demo seed on port 54322.
- All 596 pgTAP checks passed. The `divisions`, `api-services`, `frontend-components`, and `fantasy` groups passed. Both TypeScript checks, the walkthrough guard tests, and the strict coverage check passed.
- The local Worker parity runner passed 37 checks across all eight groups on `d426640`. The real-app walkthrough passed all four scenarios on `e4f6112`. See the [walkthrough](../walkthroughs/SL-040.md).

## Exact next step

1. The owner or Claude fast-forwards the main checkout's `develop` from `codex/work` and publishes it. Run the staging walkthrough from `scripts/ui-walkthrough/divisions.mjs --target staging`, then the owner attests C1.
2. Continue with SL-044, versioned rules, after SL-040 satisfies its handoff checks.

## In flight

Staging walkthrough and owner attestation for C1. The pre-existing untracked `.pnpm-store/` remains local.

## Local database

Local Supabase on 54322 is running with the lifecycle migration and the demo seed.

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

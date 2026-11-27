# Current checkpoint

The live relay checkpoint shared by Claude (main checkout, `develop`) and Codex (`../super-league-codex`,
`codex/work`). The agent that stops rewrites this file last, after committing its work. See `AGENTS.md` for the
handoff steps.

## Status

- Handoff updated on 2026-11-27. Claude can resume in the main checkout on `develop`. SL-040 and its verification are already published there.
- Phase 3 merged in PR #193 at `af61b3f`. Both local branches were fast-forwarded to that release before SL-040.
- Phase 4 is active. SL-040 is done. Local and staging walkthroughs passed on `c7b8318` and C1 was attested at the owner’s direction.
- The owner confirmed on 2026-11-27 that Codex fast-forwards and pushes `develop` at verified staging handoffs and uses the provided Cloudflare Access token for staging.
- `d426640` implements the division and season lifecycle, the audited Worker routes, the dictator workspace, and data-driven public navigation and section gating. The new management routes live in the Worker so the existing API test group covers them.
- `6a6647e` fixes landing navigation cleanup. `e4f6112` keeps the selected season in the URL when the division has no current season. `bbcb0d1` records C1 and closes the item. `c768780` records the clean-tree completion evidence.
- The owner chose to leave staff sign-in and role assignment as they are. There is no access-request work in this handoff.

## Verification

- The guarded local reset applied `20261206000000_division_season_lifecycle.sql` and the demo seed on port 54322.
- All 596 pgTAP checks passed. The `divisions`, `api-services`, `frontend-components`, and `fantasy` groups passed. Both TypeScript checks, the walkthrough guard tests, and the strict coverage check passed.
- The local Worker parity runner passed 37 checks across all eight groups on `d426640`. The real-app walkthrough passed all four scenarios locally and on staging at `c7b8318`. The item completion groups passed. See the [walkthrough](../walkthroughs/SL-040.md).

## Exact next step

Start [SL-044](../../backlog/items/SL-044.md), the versioned rules editor, with `pnpm work start SL-044`. It has not been started. Begin with the existing `seasons.rules_md` content and verify the migration before retiring the legacy reader or field. The public page serves the latest published version, and preview and version history stay in the dictator workspace. SL-045 consumes the exact accepted version later.

## In flight

No product files in flight or outstanding SL-040 checks. The pre-existing untracked `.pnpm-store/` remains local.

## Local database

Local Supabase on port 54322 is running with the lifecycle migration and the demo seed. The frontend on port 5173 and Worker on port 8787 were left running from the Codex checkout. Start them from the main checkout when verifying Claude’s next commit.

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

# Current checkpoint

The live relay checkpoint shared by Claude (main checkout, `develop`) and Codex (`../super-league-codex`,
`codex/work`). The agent that stops rewrites this file last, after committing its work. See `AGENTS.md` for the
handoff steps.

## Status

- 2026-11-27: Claude holds the work, in the main checkout on `develop`.
- Phase 4 is active. SL-040 is done. SL-044 ([plan](../plans/SL-044.md)) is built, verified and on staging; it waits for the owner's C1 attestation.
- `a78d670` versioned rules tables, backfill and seed call; `e6f3835` Worker routes; `f06e1ed` public page and dictator editor; `bf96271` drops `seasons.rules_md`.

## Verification

- 622 pgTAP checks, 110 Worker tests, 34 division tests, the local dashboard test, 270 frontend tests (20 local-only skipped), both TypeScript checks and the strict mapped-and-covered check passed.
- `scripts/ui-walkthrough/rules.mjs` passed all four scenarios locally and on staging at `bf96271` ([local](../walkthroughs/evidence/SL-044-ui-local.json), [staging](../walkthroughs/evidence/SL-044-ui-staging.json)). [Staging database run](https://github.com/IIITK-Football/super-league/actions/runs/45945503886).
- The first staging run, at `a23f838` just after the deploy, timed out once waiting for version 2 on the public page; the rerun and the `bf96271` run passed.
- The shell's Node 24 fails `ManageDivisions.local.test.jsx` (jsdom `AbortSignal`). Run tests and `pnpm work` with Node 22 (`.nvmrc`): put the folder of `pnpm dlx node@22 -e 'console.log(process.execPath)'` first on `PATH`.

## Exact next step

1. Owner: `pnpm work attest SL-044 C1 "<note>"`.
2. Under Node 22: `pnpm work done SL-044 --base e1f0bef`, fill the walkthrough `docs/walkthroughs/SL-044.md`, commit, run it again.
3. Start SL-045 (needs a plan first). It stores the accepted rules version id (`season_rules_versions.id`) and adds the player's view of that version; `season_rules(p_season)` serves only the latest.

For the walkthrough's risks: a production release must serve the new site before the migrations run, because the previous site reads `rules_md`. Rolling back past `20261207000001` needs the column added again from version 1. Each staging walkthrough reuses the archived `sl-check-rules` division and leaves one season in it, since published versions cannot be deleted.

## In flight

No product files in flight. Untracked `.github/agents`, `.github/hooks`, `.github/skills`, `.pnpm-store/` and `supabase/` predate this work and were left alone.

## Local database

Local Supabase on 54322 runs both new migrations and the demo seed. No dev servers are left running.

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

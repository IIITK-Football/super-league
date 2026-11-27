# Current checkpoint

The live relay checkpoint shared by Claude (main checkout, `develop`) and Codex (`../super-league-codex`,
`codex/work`). The agent that stops rewrites this file last, after committing its work. See `AGENTS.md` for the
handoff steps.

## Status

- 2026-11-27: Claude holds the work, in the main checkout on `develop`.
- SL-040 and SL-044 are done. Phase 4 is not yet closed with `pnpm work phase`.
- Maintenance the owner asked for, after SL-044: the Next.js runtime is removed (`5a86178`) and the toolchain is updated (through `a77a2b4`): Node 24, pnpm 12, Vite 8, Vitest 5, React 19, TypeScript 7, current GitHub Actions, current minor and patch releases, and Worker compatibility date 2026-11-20.

## Held back on purpose

- **Supabase CLI stays on 2.x** (2.122.1). Version 3 `init` writes `config.jsonc`, but the restore test in `scripts/backup/database-backup.sh` edits `config.toml`; `db push` also targets the local stack by default and needs `--remote` and `--yes`, and the project guard does not know `--remote`. An upgrade needs the backup script, `db-deploy.yml` and the guard changed together, with the restore test proven in CI.
- **ESLint stays on 9**: `eslint-plugin-react` supports no later major. `pnpm lint` in `frontend/` reports existing problems and no gate runs it.
- `lottie-react` and the unused football loader were removed, not upgraded.

## Verification

- On Node 24.22.3 and pnpm 12.23.0 at `a77a2b4`: 622 pgTAP checks, 915 backend, 114 Worker and 271 frontend tests (20 local-only skipped, run separately: 20 passed), both TypeScript checks, site and Worker builds, bundle guard, and a clean `pnpm audit` in all four packages.
- Local browser walkthroughs `rules`, `divisions`, `parity` and `match-events` passed at `a77a2b4`.
- At `9a3fd4a`: CI, Cloudflare Pages, the staging Worker build and the staging database run passed. Staging walkthroughs `rules`, `parity` and `match-events` passed. `divisions` failed intermittently when two public reads from an idle browser tab took over 12 seconds; with a 40-second staging timeout it passed 6 of 6, the slow reads answering after 10 to 14 seconds. One of 16 plain idle-gap page loads showed the same stall (12.6 s, reused HTTP/2 connection), and 40 direct reads from Node all answered within 1.1 s. The cause is unconfirmed: the connection from this machine is the likely one, and `@supabase/supabase-js` also changed (2.99 to 2.119).
- Before this, the `database`, `tooling` and `rosters` tests had stale expectations from SL-040 and SL-044 (schema counts, hidden-season fixtures) that the item completions never ran. They are fixed in `5a86178`.

## Using the toolchain locally

- Node 24.15 or later (`.nvmrc`) and pnpm 12. A global pnpm 10 cannot switch to pnpm 12 (`ENOEXEC`): run `npm install -g pnpm@12.23.0`.
- pnpm refuses releases younger than a day and runs install scripts only for `esbuild` and `workerd` (`pnpm-workspace.yaml`).

## Exact next step

1. Before the next release, open the staging site on another network after leaving a tab idle, and watch for public pages stuck on “Loading seasons…”.
2. Start SL-045 (needs a plan first). It stores the accepted rules version id (`season_rules_versions.id`) and adds the player's view of that version; `season_rules(p_season)` serves only the latest.

## Owner actions

- Upgrade the local Node and pnpm as above.
- Cloudflare: set the build variable `NODE_VERSION` to 24 for both Workers and Pages (it overrides `.nvmrc`), and review the Pages compatibility date.
- Optional: enable Dependabot alerts; delete the unused `Preview` and `Production` GitHub environments.

## In flight

Untracked `.github/agents`, `.github/hooks`, `.github/skills`, `.pnpm-store/` and `supabase/` predate this work and were left alone.

## Local database

Local Supabase on 54322 runs all migrations and the demo seed. No dev servers are left running.

## Not migrated on purpose

`auth/login`, `legends` and `admin/teams` are gone with the Next.js runtime; SL-034 still holds the rollback rehearsal and the owner's check.

## Contributor prototypes to read when their item comes up

- #185 → SL-050 phone scorer.
- #186 → SL-053 lineups.
- #187 → SL-090 design system.

## Remaining order

1. SL-045.
2. SL-050, SL-054.
3. SL-053, SL-108.
4. Phase 8: SL-104, SL-043, storage (SL-070 → SL-071 → SL-105 → SL-072 → SL-106), SL-060, SL-061.
5. Phase 9, then Phase 10.

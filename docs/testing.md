# Test groups (SL-014)

Tests are organised by domain so a change runs only the groups it can affect. The definitions, owners and path triggers live in [`tests/groups.json`](../tests/groups.json); the runner is `scripts/test-groups.mjs`.

| Group | Owner | What it covers | Status |
|---|---|---|---|
| `database` | backend | schema, migrations, seed, RLS (pgTAP on local Supabase 54322) | active |
| `config` | platform | env examples and startup validation | active |
| `tooling` | platform | scripts, group runner, hooks, workflows | active |
| `auth-identity` | backend | college email rule, password and Google same-user behavior, reset (local Auth) | active |
| `frontend-components` | frontend | React components/pages (Vitest) | active (no tests yet beyond config) |
| `auth-roles` | backend | five-role API checks and RLS | pending (SL-024/025) |
| `api-services` | backend | API services and contracts | pending (SL-026/030) |
| `match-operations` | backend | scorer, events, cards, lineups, brackets | pending (SL-050..055) |
| `fantasy` | backend | division and World Cup fantasy | pending (SL-043/055) |
| `e2e` | frontend | Playwright flows; scheduled/release only | pending (SL-100) |

A **pending** group has no tests yet. It is listed in every report, never failed, and the backlog item named in `tests/groups.json` must add its tests. Each acceptance item later adds tests to the relevant group.

## Commands (repository root)

```bash
pnpm test                       # groups affected by your uncommitted changes
node scripts/test-groups.mjs affected --staged   # groups affected by staged files
pnpm test:group config tooling  # named groups
pnpm test:all                   # full run (what CI runs nightly and on demand)
pnpm test:groups                # list groups and owners
node scripts/test-groups.mjs affected --dry-run  # show selection only
```

The `database` group needs the local stack: `pnpm db:start` (see [local-development.md](local-development.md)). It never targets anything but `127.0.0.1:54322`.

Changing a dependency manifest or lockfile selects every non-scheduled group. Documentation-only changes select none.

## Test data

Database tests use the deterministic local seed (`backend/supabase/seed.sql`, see [local-seed.md](local-seed.md)) inside a rolled-back transaction. Unit tests use isolated in-memory fixtures; none contact hosted Supabase or R2.

## Adding tests

- Backend/Workers unit tests: `backend/tests/<group>/*.test.ts` (Vitest). Frontend: `frontend/src/**/__tests__/*.test.js`. Database: `backend/supabase/tests/database/*.test.sql` (pgTAP).
- If a new area needs its own group, add it to `tests/groups.json` with an owner and path triggers; `tests/groups.json` is validated by the `tooling` group.

## Commit-time hook

`pnpm hooks:install` runs `node scripts/test-groups.mjs affected --staged` before each commit (after staged-file safety checks), so only the groups your staged paths select run; no unrelated suites. Failures print the group and the command to re-run it. See `CONTRIBUTING.md` for the logged emergency bypass.

## CI

`.github/workflows/ci.yml` installs with `pnpm install --frozen-lockfile` (same lockfiles and package manager as local), picks groups with the runner (`affected --base <ref>` on pull requests and pushes, `all` nightly and on manual dispatch), starts local Supabase only when `database` is selected, and writes a per-group summary (ran / pending / not affected) to the job summary. CI is the final authority.

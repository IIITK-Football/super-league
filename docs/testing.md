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

## Strict rules (no change can go untested)

`node scripts/test-groups.mjs check` (staged files by default, or `--base <ref>` for a whole range, or `--files …`) applies three rules to every changed file that is not an approved exemption. It runs no tests; `affected --strict` applies it first and then runs the affected groups.

1. **Mapped:** some group's `paths`, `covers` or `testPaths` must match it, otherwise nothing would run for it.
2. **Covered:** an **active** group's `covers` must match it. A pending group has no tests, so it covers nothing; a file only a pending group maps is rejected until tests exist (the message names the backlog item that adds them).
3. **Tested:** the change set must contain a changed or added test file (a group's `testPaths`) from a group that covers it. This rule runs over the whole outgoing range at push and in CI; the commit hook defers just this rule (`--commit-stage`) so a small follow-up commit is not blocked.

There is no per-change opt-out. `tests/gate-exemptions.json` lists whole categories that need no tests (documentation, lockfiles, assets, vendored tools), each with a reason; changing it needs the owner's explicit confirmation. A group's `covers` and `testPaths` are what a reviewer reads to learn what its tests really verify, so declare them honestly. `--evidence <file>` records the commit, the tree and each command's exit code as JSON, which the completion walkthrough uses.

## Git hooks

`pnpm install` installs the hooks (the root `prepare` script runs `scripts/install-hooks.sh --auto`; it never fails an install and never overrides a hooks path you configured yourself). They share their logic with CI (`scripts/hooks/lib.mjs`, `scripts/hooks/hygiene.mjs`), so a local result and the CI result cannot disagree.

- **pre-commit:** blocks `.env` and key files and secret-looking additions, then `affected --staged --strict --commit-stage`: the strict rules except "changed source needs a changed test", then only the groups the staged paths select.
- **commit-msg:** Conventional Commits, 72 characters, no backlog references.
- **pre-push:** only `ready/<name>` branches may be pushed (`develop` and `main` are reached by pull request). Over the whole outgoing range it checks hygiene (conventional messages, no fixup/squash/WIP commits, no merge commits, no env or key files, no secrets), the full strict rules, and runs the affected groups. The pushed commit must be the one checked out, so the tests run against what is published.

There is no bypass variable or flag. A person can still run `git commit --no-verify` or `git push --no-verify` by hand, which only skips the local copy: CI applies the same rules and cannot be skipped.

## CI

`.github/workflows/ci.yml` installs with `pnpm install --frozen-lockfile` (same lockfiles and package manager as local), picks groups with the runner (`affected --base <ref>` on pull requests and pushes, `all` nightly and on manual dispatch), starts local Supabase only when `database` is selected, and writes a per-group summary (ran / pending / not affected) to the job summary. CI is the final authority.

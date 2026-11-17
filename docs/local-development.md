# Local development environment (SL-001)

**Rule:** routine development targets only this repository's local Supabase stack (`backend/supabase/`, database port **54322**). Hosted production is never touched by a routine command.

## Local ports (from `backend/supabase/config.toml`)

| Service | Port |
|---|---|
| API (Kong) | 54321 |
| Postgres | **54322** |
| Studio | 54323 |
| Inbucket (mail) | 54324 |

## Known hazard: the CLI link points at a hosted project

`backend/supabase/.temp/linked-project.json` (git-ignored CLI state) records a **hosted** project. Supabase CLI commands such as `db push`, `db pull`, `migration up --linked`, and `link` act on it when `--local` is not given. The link is meant to point at the **staging** project, never production: production changes go only through GitHub Actions (see [`release.md`](release.md), which also shows how to move the link). Therefore:

1. Do not run `supabase link`, `--linked`, `db push`, `db pull`, `branches`, `secrets`, or `functions deploy` during development unless you have deliberately chosen to act on staging.
2. Always pass an explicit local target, shown below.
3. Check where the link points with `cat backend/supabase/.temp/project-ref`. If it is the production reference, relink to staging as described in `release.md`.
4. Assistants and scripts in this repository never run these commands without your explicit approval.

## Explicit local commands

Run from `backend/`. Use `pnpm`, never `npm`.

```bash
# 1. Confirm the stack and port BEFORE anything that writes (read-only).
pnpm exec supabase status          # DB URL must show 127.0.0.1:54322

# 2. Start / stop the local stack.
pnpm exec supabase start
pnpm exec supabase stop

# 3. Rebuild the local DB from migrations + seed. --local is mandatory.
pnpm exec supabase db reset --local

# 4. Apply pending migrations to the local DB only.
pnpm exec supabase migration up --local

# 5. Ad-hoc SQL: always spell out the local URL.
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
```

Stop immediately if `status` is not reachable, shows a port other than 54322, or a URL that is not `127.0.0.1`/`localhost`.

## Environment files

- `backend/.env.local`, `frontend/.env.local` and `frontend/.dev.vars` are git-ignored. Their Supabase URLs must be `http://127.0.0.1:54321`. A hosted `*.supabase.co` URL in any of them is a mistake for local work.
- Copy the examples (`frontend/.env.example`, `frontend/.dev.vars.example`, `backend/.env.example`) and fill them from `pnpm exec supabase status`, which prints the local **publishable** and **secret** keys. Every variable, where it belongs and which key may be used where is in [`environment.md`](environment.md). The secret key is backend-only; startup validation and the frontend build refuse it under a public prefix.
- If you still have the old names (`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_ANON_KEY`), rename them; startup tells you what each was renamed to.

## Guarded helper (SL-013)

`scripts/local-db.sh` wraps the commands above with checks. From the repository root:

```bash
pnpm db:check        # read-only: config + running target must be project "backend" on 127.0.0.1:54322
pnpm db:start        # inspects first: refuses if 54322 is held by another process
pnpm db:reset        # DESTRUCTIVE: prints the target, asks you to type "reset 54322" (or pass --yes)
pnpm db:test         # pgTAP tests (supabase/tests/database)
pnpm db:psql         # psql on the verified local URL
pnpm db:stop
```

Guarantees (covered by `backend/tests/tooling/local-db.test.ts`):
- `set -euo pipefail`; errors are never suppressed, and a failed status check is never reported as success.
- The config must say `project_id = "backend"` and `[db] port = 54322`, and `supabase status` must report a DB at `127.0.0.1:54322`. Any other port (including the separate backup stack on 55322) or host aborts before anything runs.
- Only a fixed set of commands is accepted; arbitrary arguments, hosted-project flags, and Docker container/network/volume commands are not available.

## Inspect-before-start workflow (port collisions)

Local Supabase containers are named `supabase_*_backend` (the project id). Docker/Colima can leave another stack holding a port, so before starting:

1. `pnpm db:check`. If it succeeds the stack is already running; do not start another.
2. If it fails, `pnpm db:start`. It refuses when something else listens on 54322 and tells you to stop that yourself.
3. Never remove, stop, or prune containers, networks, or volumes that you did not create for this project. Other projects on this machine (for example a backup Supabase on 55322) are out of scope.

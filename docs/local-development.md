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

## Which checkout is being served

The dev servers serve whatever checkout they were started from. When work happens in a git worktree or on another branch, start the web and API servers **from that checkout** (or switch the running checkout to the branch) before verifying a screen, and note the commit that was served: `git -C <checkout> rev-parse --short HEAD`. A dashboard that still shows a retired screen or queries a dropped table is almost always a server started from an older checkout against a database that has already been migrated. The UI walkthrough evidence required by rule R10 names that commit.

Starting the web and API servers from a checkout (their environment files live in that checkout and are git-ignored):

```bash
pnpm db:start                      # local Supabase on 54322, if it is not running
pnpm --dir api dev                 # API Worker (Hono under wrangler dev) on http://127.0.0.1:8787
pnpm dev:frontend                  # web on http://localhost:5173; Vite proxies /api to the Worker
git rev-parse --short HEAD         # the commit being served
```

The browser only ever calls `/api` on its own origin: Vite forwards it to the Worker locally (`API_PROXY_TARGET` overrides
the target), and the Pages site forwards it through its `API` service binding when hosted. Leave `VITE_API_URL` blank.
The Next.js dev server (`pnpm dev:backend`, port 3000) is no longer how the API runs.

If a server is already listening on 8787 or 5173, stop it first (`lsof -nP -iTCP:5173 -sTCP:LISTEN`), so the port serves the checkout you mean to verify.

### Media and R2, locally
- `wrangler dev` emulates the R2 buckets the Worker writes to (`R2_NEWS`, `R2_PLAYERS`, `R2_LOGOS` bound to `sl-local-*`
  in `api/wrangler.jsonc`) on disk under `api/.wrangler/`. No Cloudflare account or credentials are involved. Uploaded
  files are served back from `/api/local-media/<purpose>/<key>`, a route that exists only when `SL_ENVIRONMENT=local`.
- Existing read-only media still comes from public R2 hosts over the internet: the home video (proxied by `/api/media`
  from `MEDIA_BASE_VIDEO`), its posters and the play-style icons. Without internet those do not load; nothing else is affected.

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

- Normal development needs two git-ignored files, both pointing at `http://127.0.0.1:54321`:
  - `api/.dev.vars` (copy `api/.dev.vars.example`): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SL_ENVIRONMENT=local`, read by `wrangler dev`;
  - `frontend/.env.local` (copy `frontend/.env.example`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, the Turnstile test key, and a blank `VITE_API_URL`.
- Fill the keys from `pnpm exec supabase status -o env` (in `backend/`), which prints the local `PUBLISHABLE_KEY` and `SECRET_KEY`. A hosted `*.supabase.co` URL in either file is a mistake for local work. The secret key belongs only in `api/.dev.vars`; the frontend build refuses it under a public prefix.
- Optional: `frontend/.dev.vars` (only for `wrangler pages dev`, the Pages Functions) and `backend/supabase/.env` (local Google sign-in or a real Turnstile secret). `backend/.env.example` is the maintainers' template for `backend/.env.staging.local`, used only by the scripted staging checks.
- `node scripts/env-status.mjs` reports which of these variables are set, by name only. Every variable, where it belongs and which key may be used where is in [`environment.md`](environment.md).
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

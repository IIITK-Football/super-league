# Local development environment (SL-001)

**Rule:** routine development targets only this repository's local Supabase stack (`backend/supabase/`, database port **54322**). Hosted production is never touched by a routine command.

## Local ports (from `backend/supabase/config.toml`)

| Service | Port |
|---|---|
| API (Kong) | 54321 |
| Postgres | **54322** |
| Studio | 54323 |
| Inbucket (mail) | 54324 |

## Known hazard: this checkout is linked to a hosted project

`backend/supabase/.temp/linked-project.json` exists (git-ignored CLI state). Supabase CLI commands such as `db push`, `db pull`, `migration up --linked`, and `link` act on that **hosted** project when `--local` is not given. Therefore:

1. Never run `supabase link`, `--linked`, `db push`, `db pull`, `branches`, `secrets`, or `functions deploy` during development.
2. Always pass an explicit local target, shown below.
3. Do not edit or delete `.temp/`; just never use the link.

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

- `backend/.env.local` and `frontend/.env.local` are git-ignored. Their Supabase URLs must be `http://127.0.0.1:54321`. A hosted `*.supabase.co` URL in either file is a mistake for local work.
- Only the frontend `.env.example` is tracked today; a backend example and config validation are SL-012. Private keys (service role, R2) must never be placed in `VITE_*` variables.

## What is not yet automated

Wrapper scripts, config validation, and a guard that refuses non-local targets are **SL-013** (Phase 1). Until then, the explicit flags above are the safeguard.

# Contributing to Super League

Thanks for helping. This guide gets you from a fresh clone to a reviewed pull request. Everything runs locally: you need
no production or staging access and no secrets.

## How the project is built

| Directory | What it is | Runs on |
|---|---|---|
| `frontend/` | React 18 + Vite app, plus Pages Functions (`frontend/functions/`) | Cloudflare Pages |
| `api/` | The Hono API Worker: routes, auth checks, R2 media through bindings | Cloudflare Workers |
| `backend/app/api/`, `backend/lib/` | The route handlers and shared logic the Worker serves (plain Web `Request`/`Response`) | inside the Worker |
| `backend/supabase/` | Database migrations, the synthetic seed and pgTAP tests | Supabase (Postgres + Auth) |

The browser calls `/api/*` on its own origin; Pages forwards it to the Worker, so there is no CORS. Most product rules
live in the database (row level security and RPCs), so many features are a migration plus a screen. The product terms
(division, season, roles: normal user, captain, scorer, editor, dictator) are defined in `docs/decisions/`.

## Set up locally

Prerequisites: Node.js 22.19+ (`.nvmrc`), pnpm 10 (`corepack enable`), and Docker for local Supabase. Use **pnpm only**.

```bash
pnpm install --frozen-lockfile        # installs every workspace and the git hooks
pnpm db:start                         # local Supabase on 127.0.0.1:54322 (API on 54321), with the synthetic seed
cp frontend/.env.example frontend/.env.local   # fill in the local publishable key from `pnpm --dir backend exec supabase status`
cp api/.dev.vars.example api/.dev.vars         # local Supabase URL and keys, same source
pnpm --dir api dev                    # the API Worker on :8787 (R2 buckets are emulated on disk; no Cloudflare account needed)
pnpm dev:frontend                     # Vite on :5173; /api is proxied to the Worker
```

Local media uploads go to emulated buckets and are served from `/api/local-media/...`. To rebuild the local database
from migrations and seed: `bash scripts/local-db.sh reset --yes` (local only; it refuses any other database).
More detail: `docs/local-development.md`, `docs/environment.md`.

## Make a change

1. Fork the repository, then branch from `develop`: `git checkout -b feat/short-name develop`.
2. Write the test first where you can, then the change. Tests are grouped by area (`docs/testing.md`):
   - `pnpm test` runs the groups your changes affect;
   - `pnpm --dir api test` runs the Worker tests; `bash scripts/local-db.sh test` runs the database tests;
   - for anything role-sensitive, test both the allowed and the refused case.
3. Database changes are new files in `backend/supabase/migrations/` (never edit an existing one), with a pgTAP test.
4. Run `pnpm --dir backend exec tsc --noEmit` and `pnpm --dir api exec tsc --noEmit` before pushing TypeScript.

## Commit and open a pull request

- Commits follow Conventional Commits in plain words, at most 72 characters, for example
  `fix(profiles): stop reading profile emails`. No backlog numbers and no tool or AI attribution lines.
- The git hooks block `.env` files, keys and secret-looking text; CI runs the same checks. There is no bypass.
- Open the pull request **into `develop`**, with "Allow edits from maintainers" on. Say what changed, why, and how you
  tested it. Code owners are requested automatically (`.github/CODEOWNERS`).
- After merge, `develop` deploys to staging automatically. Only the maintainer releases `develop` to `main`
  (production), through a reviewed pull request and an approved database deploy.

## Rules that keep the live site safe

- Never commit secrets or real `.env` values; examples hold placeholders only.
- Never point local work at a hosted database or bucket. Local code refuses production media hosts, and the staging
  Worker refuses the production database.
- A hidden button is not authorization: enforce every role rule in the API and in row level security.
- World Cup (`/wc`) is a finished, read-only archive: no new features there.

Questions or ideas: open an issue. Thank you for contributing.

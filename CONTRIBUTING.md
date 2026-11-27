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

Prerequisites: Node.js 24.15+ (`.nvmrc`), pnpm 12 (`corepack enable`), Docker (for local Supabase) and an internet
connection. Use **pnpm only**. You need no Cloudflare or Supabase account.

**1. Install and start the local database**

```bash
pnpm install --frozen-lockfile    # every workspace (frontend, api, backend) and the git hooks
pnpm db:start                     # local Supabase: API 127.0.0.1:54321, Postgres 54322, Studio 54323, Mailpit 54324
```

The first start applies every migration and the synthetic seed (`backend/supabase/seed.sql`). `pnpm db:check` confirms
the stack; `pnpm db:reset` rebuilds it from migrations and seed (local only; it asks first and refuses any other
database).

**2. Create the two local env files** (both git-ignored). The values come from the local stack:

```bash
pnpm --dir backend exec supabase status -o env   # prints API_URL, PUBLISHABLE_KEY and SECRET_KEY (local only)
cp api/.dev.vars.example api/.dev.vars           # SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY from the output
cp frontend/.env.example frontend/.env.local     # VITE_SUPABASE_PUBLISHABLE_KEY from the output; leave VITE_API_URL blank
```

The URLs are already `http://127.0.0.1:54321`, `SL_ENVIRONMENT=local` is set, and the Turnstile test key is filled in.
Never put the secret key in a `VITE_` variable: it belongs only in `api/.dev.vars`.

**3. Run the API Worker and the web app** (two terminals)

```bash
pnpm --dir api dev     # Hono API Worker under wrangler dev on http://127.0.0.1:8787
pnpm dev:frontend      # Vite on http://localhost:5173; it proxies /api to the Worker
```

Open http://localhost:5173. The app calls `/api` on its own origin, as on the real site. Sign in with an account you
create locally; confirmation mail arrives in Mailpit at http://127.0.0.1:54324.

**Media, locally**
- Uploads (player portraits, team logos, news images) go to R2 buckets that `wrangler dev` **emulates on disk**
  (`sl-local-*` in `api/wrangler.jsonc`). No Cloudflare credentials are needed, and they are served back from
  `/api/local-media/...`.
- Some existing media is **read** from public R2 hosts and needs internet: the home video (proxied through
  `/api/media`), its posters and the play-style icons. Offline, those images and the video simply do not load.

**Optional**
- `frontend/.dev.vars` (from `frontend/.dev.vars.example`) is only for `wrangler pages dev`, to try the Pages
  Functions (share-preview meta tags). Vite does not run them.
- `backend/supabase/.env` (from its example) is only for trying Google sign-in locally or a real Turnstile secret.
- `backend/.env.example` is not part of local setup: it is the maintainers' template for the scripted staging checks.

**Troubleshooting**
- `/api` requests fail or time out: the Worker is not running (step 3), or something else holds port 8787.
- The API answers `503 "The API is not configured correctly."`: `api/.dev.vars` is missing a value.
- A blank page with `Missing environment variables: VITE_SUPABASE_...` in the browser console: `frontend/.env.local` is
  missing a value (restart Vite after editing it).
- `pnpm db:start` refuses to start: another process holds port 54322 (see `docs/local-development.md`).

More detail: `docs/local-development.md`, `docs/environment.md`, `docs/testing.md`.

## Make a change

Review the linked backlog item's flow, key screens and acceptance scenarios before building. Contributors can prepare approved work in parallel on separate branches. Integration follows the shared Worker baseline and the [release prerequisites](backlog/phases.md). Maintainers record backlog status and staging evidence.

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

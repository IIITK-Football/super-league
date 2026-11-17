# Environment variables

Supabase replaced the legacy `anon` and `service_role` API keys with **publishable** and **secret** keys. This page lists every variable, where it belongs, and what it does. Examples contain placeholders only: **never commit a real key**.

## Which key goes where

| Key | Format | Privilege | May be used in |
|---|---|---|---|
| Publishable | `sb_publishable_...` | Low: Row Level Security applies | Browser code, the Pages Function, and backend code that acts as a user |
| Secret | `sb_secret_...` | **High: bypasses RLS** | **Only** backend server code that genuinely needs elevated access (the files listed in [`supabase-key-usage.md`](supabase-key-usage.md)). Never in the frontend, a `VITE_` or `NEXT_PUBLIC_` variable, Git, logs or chat |

New keys are **not JWTs**: never send one as `Authorization: Bearer`. supabase-js and `@supabase/ssr` handle this; hand-written requests send the publishable key as the `apikey` header only. The old names (`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_ANON_KEY`) are no longer read: startup reports them as renamed (by name only).

## Runtime application variables

| Variable | Where it is set | What it does |
|---|---|---|
| `VITE_SUPABASE_URL` | Frontend `.env.local` (local), Pages **build** variables (hosted) | Project URL for the browser client |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | same | Browser client key |
| `VITE_TURNSTILE_SITE_KEY` | same | Public Cloudflare Turnstile site key |
| `VITE_API_URL` | same | Backend API base (blank = same origin) |
| `VITE_ALLOW_REMOTE_SUPABASE` | ignored local files only | Dev opt-in to use a non-local Supabase project |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | `frontend/.dev.vars` (local), Pages **Functions** variables (hosted) | Share-preview lookup in `frontend/functions/_middleware.js` |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | `backend/.env.local` (local), Vercel (hosted) | Backend routes: publishable for user-level clients, secret for the routes in `supabase-key-usage.md` |
| `ALLOW_REMOTE_SUPABASE` | ignored local files only | Dev opt-in for a non-local project |
| `CRON_SECRET`, `API_FOOTBALL_KEY`, `API_SPORTS_KEY` | backend env | Scheduled jobs and third-party APIs (not Supabase keys) |
| `R2_*`, `NEXT_PUBLIC_*R2*` | backend env | Cloudflare R2 media (unchanged; storage redesign is separate) |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID/_SECRET`, `SUPABASE_AUTH_CAPTCHA_SECRET` | `backend/supabase/.env` (local Auth config) | Local Google sign-in and Turnstile secret |

Examples: [`frontend/.env.example`](../frontend/.env.example) (browser), [`frontend/.dev.vars.example`](../frontend/.dev.vars.example) (Pages Functions), [`backend/.env.example`](../backend/.env.example) (server), [`backend/supabase/.env.example`](../backend/supabase/.env.example) (local Auth).

## Not API keys: migration credentials (GitHub Actions only)

`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` (secrets) and `SUPABASE_PROJECT_REF` (variable) are **Supabase CLI** credentials used only by `.github/workflows/db-deploy.yml`, scoped to the `Database Preview` (staging project) and `Database Production` (production project) GitHub Environments (see [`release.md`](release.md)); the environments `Preview` and `Production` belong to the Vercel integration and are not used. They are unrelated to the publishable and secret keys. Application code never reads them, and the deploy workflow never uses an API key. Whether a Supabase access token can be limited to one project is **unverified**: check it in Supabase and treat the token as able to reach every project until you have.

## Per environment

| | Local | Staging | Production |
|---|---|---|---|
| Source of keys | `pnpm exec supabase status` (backend/) prints the local publishable and secret keys | Dashboard of the staging project: Project Settings -> API Keys | Dashboard of the production project: Project Settings -> API Keys |
| Frontend | `frontend/.env.local` | `frontend/.env.staging.local` with `vite --mode staging` | Cloudflare Pages build variables |
| Pages Function | `frontend/.dev.vars` | n/a | Pages Functions variables |
| Backend | `backend/.env.local` | `backend/.env.local` pointed at staging with `ALLOW_REMOTE_SUPABASE=true` | Vercel environment variables |

Put values only in git-ignored files or host settings. Use a **separate named secret key per environment** so one can be revoked without touching the others.

## Safeguards
- The frontend Vite config fails the build if any `VITE_` name looks private, and `node frontend/scripts/check-bundle.mjs` scans the built files for secret-key formats.
- Backend startup validation (`backend/lib/env.ts`) names missing or renamed variables and rejects secrets under public prefixes.
- A test lists every backend file allowed to use the secret key, so new elevated usage needs a deliberate, reviewed change.
- The pre-commit hook blocks secret-looking additions.

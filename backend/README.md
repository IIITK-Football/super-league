# backend/

What this folder holds now that the API runs as the Hono Worker in [`api/`](../api):

| Path | What it is |
|---|---|
| `app/api/**/route.ts` | The API route handlers. They use only the Web `Request`/`Response` types, and the Worker mounts them (`api/src/routes.ts`); the route table there lists exactly which ones are served |
| `lib/` | Shared server logic: auth and roles, division/season scope, match events, grading, media storage through R2 bindings (`lib/storage.ts`) |
| `supabase/` | The Supabase CLI project: migrations (`supabase/migrations/`, forward-only), the synthetic seed (`supabase/seed.sql`), pgTAP tests (`supabase/tests/database/`) and local config (`supabase/config.toml`, database port 54322) |
| `tests/` | Vitest tests grouped by area (`tests/groups.json` at the repository root maps them); integration tests run against the local Supabase stack |

## Local setup and tests

Follow [`CONTRIBUTING.md`](../CONTRIBUTING.md) for the full setup. From the repository root:

```bash
pnpm db:start                                  # local Supabase (127.0.0.1:54322)
pnpm --dir backend exec vitest run tests       # backend tests (local stack); files run one at a time
pnpm --dir backend exec tsc --noEmit           # type check
pnpm db:test                                   # pgTAP database tests
```

Database changes are new migration files only; never edit one that exists. Apply them locally with `pnpm db:reset`
(local only). Hosted databases change only through the reviewed GitHub workflow (`docs/release.md`), never from a laptop.

`.env.example` here is not part of local setup: it is the maintainers' template for `backend/.env.staging.local`,
used only by the scripted staging checks. See [`docs/environment.md`](../docs/environment.md).

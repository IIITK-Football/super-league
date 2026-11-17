# Database release: staging and production

Database changes reach the hosted projects only through GitHub Actions (`.github/workflows/db-deploy.yml`). Nobody applies migrations to a hosted project from a laptop.

| Branch | Supabase project | GitHub environment | What runs | Seed |
|---|---|---|---|---|
| `develop` | staging (`super-league-staging`) | `Database Preview` | migrations (`db push`) | **yes**, the synthetic seed (`--include-seed`) |
| `main` | production (the original project) | `Database Production` | migrations only, after a required reviewer approves | **never** |

The GitHub environments named `Preview` and `Production` are owned by the Vercel integration and are deliberately **not** used here, so Vercel's deployment tracking and this workflow's secrets and protection rules never mix. Do not create an environment called `staging`.

Both jobs first prove the migrations and seed on an empty **local** database (the `database` test group). Each environment has its own project reference and secrets. The workflow only runs when migrations, the seed or the workflow itself change, and never on pull requests.

## One-time setup (owner)

### Supabase dashboard
1. Create the staging project **and leave it empty**: do not paste SQL or run migrations in it. The workflow's first run applies all three migrations and the seed. (Same region as production; keep the database password in your password manager.)
2. Note each project's **Reference ID** (Project Settings → General). They are identifiers, not secrets.
3. Create two access tokens (Account → Access Tokens): one for staging, one for production, each copied once straight into GitHub. **Scope is unverified:** nothing in this repository can tell whether a token is limited to one project or can act on every project in your account. Check in Supabase (Account → Access Tokens) without revealing the token, prefer the narrowest scope offered, and until then treat each token as able to reach both projects and as highly sensitive. These are **CLI/migration credentials**, not Supabase API keys: the application's publishable and secret keys are separate and are listed in [`environment.md`](environment.md).
4. Set staging's Auth settings by hand (Confirm email, minimum password 8, Secure password change, redirect URLs, SMTP, Turnstile): the workflow deploys the database only, never Auth settings (`config push` is deliberately not used because it would overwrite dashboard settings).
5. Free projects pause when idle. A paused staging project makes the staging job fail until you resume it.

### GitHub (Settings)
1. **Environments → New environment `Database Preview`:** deployment branches = selected branches → `develop`. Secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` (staging values); variable `SUPABASE_PROJECT_REF` (staging reference).
2. **Environments → New environment `Database Production`:** deployment branches = selected branches → `main`; **Required reviewers** = you; the same three names with **production** values.
   (The existing `Preview` and `Production` environments are Vercel's: leave them alone. Moving the values from them into the two new environments is up to you; deleting the copies in Vercel's environments afterwards is optional.)
3. **Secrets and variables → Actions → Variables:** repository variable `PRODUCTION_PROJECT_REF` (the production reference). The staging job refuses to run if its reference equals this.
4. Put **no** Supabase secret at repository level, so a `develop` run can never read production's.
5. Actions → General: workflow permissions "Read repository contents"; require approval for outside contributors' workflow runs. Recommended: protect `main` (pull request and CI checks required).

### Your laptop
Move the CLI link from production to staging, then production credentials are no longer needed locally:
```bash
cd backend
pnpm exec supabase login
pnpm exec supabase unlink
pnpm exec supabase link --project-ref <staging reference>   # asks for the staging database password
cat supabase/.temp/project-ref                              # must print the staging reference
```
Assistants and scripts in this repository still never run `link`, `--linked` or hosted commands unless you approve it.

## Before production runs for the first time

Production was created from the legacy migrations by hand. **It has no migration history at all**: querying `supabase_migrations.schema_migrations` fails with `42P01: relation does not exist`. That means a populated database with no ledger, not an empty database. The baseline must therefore be **marked as applied, never run**, and the production job refuses to continue while the baseline is still listed as pending (the "Refuse to replay the baseline migration" step). **History is marked, never re-run.**

1. **Read-only: compare production's schema with the baseline.** Run the read-only inventory (`scripts/sql/schema-inventory.sql`) in the **production** SQL Editor (it starts with `BEGIN READ ONLY`, so it cannot write), export the result to a file **outside the repository**, and give the assistant the path. The same inventory is produced from the local database with `pnpm db:inventory <file>`; the assistant then compares the two offline. Do not mark the baseline applied until the two agree or every difference is understood.
2. **Review the differences** with the assistant. Objects only in production, objects only in the baseline and different function bodies or policies each have a separate decision (see "Comparison outcomes" below). Because the baseline has not been applied to any hosted project yet, it can still be amended before its first hosted run.
3. **Manual export (no backup exists on the free plan):** see the export gate in `docs/auth.md`. Do this immediately before the first production run.
4. **Repair the history** (separate approval; history rows only, no schema change). Run from `backend/` with a production connection string kept in an environment variable (percent-encoded, never typed into a shared place and never `--linked`):
   ```bash
   # production has no row for the baseline: record it as already applied
   pnpm exec supabase migration repair --status applied 20261106000000 --db-url "$PRODUCTION_DB_URL"
   pnpm exec supabase migration repair --status applied 20261106180125 --db-url "$PRODUCTION_DB_URL"
   # production lists a version that has no local file: remove its history row only
   pnpm exec supabase migration repair --status reverted <version> --db-url "$PRODUCTION_DB_URL"
   pnpm exec supabase migration list --db-url "$PRODUCTION_DB_URL"   # local and remote columns now match, except 20261117000000
   ```
   Do not use `db pull` to bring old migrations into the repository: they would run on staging and collide with the baseline. The legacy files stay in `backend/supabase/migrations_legacy/`.
5. `20261117000000_auth_college_domain_and_new_user_triggers.sql` is then the only pending production migration, applied by the workflow.

### Comparison outcomes
| Result | What it means | Next gate |
|---|---|---|
| Identical, or cosmetic differences only | Production already equals the baseline | After the manual export, you mark `20261106000000` and `20261106180125` as applied (repair, history rows only); CI then applies only `20261117000000` |
| Production has extra objects | Hand-made additions not in the repository | Either absorb them into the baseline before its first hosted run (needs a local database rebuild, which removes local-only accounts unless exported first) or leave them and document them for later cleanup |
| The baseline has objects production lacks | Marking the baseline applied would be false | A small reconcile migration, reviewed first, applied through CI after the export |
| Different function bodies or policies | Behavioural drift | Review which is correct; nothing is changed automatically |
Also confirm migration `20261117000000` is safe against production's real `enforce_college_domain()`, `handle_new_user()` and `auth.users` triggers, which the inventory includes.

## First run, in order (each step needs your approval)
1. Staging created empty, GitHub environments and secrets set, laptop relinked to staging.
2. **Push `develop`.** The `staging` job applies all three migrations and the seed. Check staging: `supabase_migrations.schema_migrations` lists three versions and the fixture rows exist.
3. Work through the staging checks in `docs/auth.md`.
4. Complete "Before production runs for the first time".
5. **Merge `develop` into `main`** through a pull request. The `production` job waits for your approval, prints a dry run in its summary, then applies only `20261117000000`. The same merge also triggers the Pages production build: the new frontend works with the old database triggers, and CAPTCHA stays off until you enable it, so set the Pages site key before enabling CAPTCHA (see `docs/auth.md`).

## Manual runs
Actions → *Database deploy* → Run workflow on `develop` or `main`. It defaults to a **dry run** that only prints pending migrations; untick the box to apply.

## If something fails
- **Staging job fails:** nothing in production is affected. Fix forward with a new migration. A paused project (resume it) or a network error from the runner (free-plan direct connections can be IPv6-only; tell the assistant to add the pooler connection) are the usual causes.
- **Production job fails:** each migration runs in a transaction, so a failing one changes nothing. Read the job log, fix forward with a new migration, and use `docs/rollback/` for the auth triggers if needed.
- **Seed refuses to run:** the seed aborts if the database has more than 20 accounts outside its own fixtures. That is the safeguard against seeding real data; it should never trigger on staging.
- **Rolling back:** database changes are forward-fix only, backed by your manual export. There is no automatic revert.

# Database release: staging and production

Database changes reach the hosted projects only through GitHub Actions (`.github/workflows/db-deploy.yml`). Nobody applies migrations to a hosted project from a laptop.

| Branch | Environment | What runs | Seed |
|---|---|---|---|
| `develop` | `staging` | migrations (`db push`) | **yes**, the synthetic seed (`--include-seed`) |
| `main` | `production` | migrations only, after a required reviewer approves | **never** |

Both jobs first prove the migrations and seed on an empty **local** database (the `database` test group). Each environment has its own project reference and secrets. The workflow only runs when migrations, the seed or the workflow itself change, and never on pull requests.

## One-time setup (owner)

### Supabase dashboard
1. Create the staging project **and leave it empty**: do not paste SQL or run migrations in it. The workflow's first run applies all three migrations and the seed. (Same region as production; keep the database password in your password manager.)
2. Note each project's **Reference ID** (Project Settings → General). They are identifiers, not secrets.
3. Create two access tokens (Account → Access Tokens): one for staging, one for production, each copied once straight into GitHub. A token carries your account's access, so treat it as highly sensitive; use scoped tokens if your dashboard offers them.
4. Set staging's Auth settings by hand (Confirm email, minimum password 8, Secure password change, redirect URLs, SMTP, Turnstile): the workflow deploys the database only, never Auth settings (`config push` is deliberately not used because it would overwrite dashboard settings).
5. Free projects pause when idle. A paused staging project makes the staging job fail until you resume it.

### GitHub (Settings)
1. **Environments → New environment `staging`:** deployment branches = selected branches → `develop`. Secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` (staging values); variable `SUPABASE_PROJECT_REF` (staging reference).
2. **Environments → New environment `production`:** deployment branches = selected branches → `main`; **Required reviewers** = you; the same three names with **production** values.
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

Production was created from the legacy migrations by hand, so its migration history table may not match the files in `backend/supabase/migrations/`. The workflow's first production push would stop with an error rather than change anything wrong, but fix the history first. **History is marked, never re-run.**

1. **Read-only: look at production's history** (SQL editor): `select version, name from supabase_migrations.schema_migrations order by version;` (tell the assistant if the table does not exist).
2. **Drift check:** take a **schema-only** export of production and compare it with `20261106000000_baseline.sql` (the assistant can compare offline from the file). Do not mark the baseline applied until the schemas agree.
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

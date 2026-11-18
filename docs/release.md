# Database release: staging and production

Database changes reach the hosted projects only through GitHub Actions (`.github/workflows/db-deploy.yml`). Nobody applies migrations to a hosted project from a laptop.

| Branch | Supabase project | GitHub environment | What runs | Seed |
|---|---|---|---|---|
| `develop` | staging (`super-league-staging`) | `Database Preview` | migrations (`db push`), then the seed and its checks (`scripts/preview-seed.sh`) | **yes**, the existing synthetic seed, refreshed on every run |
| `main` | production (the original project) | `Database Production` | migrations only, after a required reviewer approves | **never** |

The GitHub environments named `Preview` and `Production` are owned by the Vercel integration and are deliberately **not** used here, so Vercel's deployment tracking and this workflow's secrets and protection rules never mix. Do not create an environment called `staging`.

Both jobs first prove the migrations and seed on an empty **local** database (the `database` test group). The `verify` job also runs the seed a **second time** and fails if any row count changes, then runs the Preview checks, all on that local database. Each environment has its own project reference and secrets. The workflow only runs when migrations, the seed or the workflow itself change, and never on pull requests.

## One-time setup (owner)

### Supabase dashboard
1. Create the staging project **and leave it empty**: do not paste SQL or run migrations in it. The workflow's first run applies all four migrations and the seed. (Same region as production; keep the database password in your password manager.)
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
4. **Repair the history** (separate approval; history rows only, no schema change). The simplest way is `bash scripts/production-history-repair.sh`: it asks for the Session pooler connection string and the password with hidden input, fixes common problems (stray quotes, a password that needs percent-encoding, the `[YOUR-PASSWORD]` placeholder), verifies the target is the production project before changing anything, runs the two repairs below, and stops unless exactly the two new migrations remain pending. By hand, run from `backend/` with a production connection string kept in an environment variable (percent-encoded, never typed into a shared place and never `--linked`):
   ```bash
   # production has no row for the baseline: record it as already applied
   pnpm exec supabase migration repair --status applied 20261106000000 --db-url "$PRODUCTION_DB_URL"
   pnpm exec supabase migration repair --status applied 20261106180125 --db-url "$PRODUCTION_DB_URL"
   # production lists a version that has no local file: remove its history row only
   pnpm exec supabase migration repair --status reverted <version> --db-url "$PRODUCTION_DB_URL"
   pnpm exec supabase migration list --db-url "$PRODUCTION_DB_URL"   # local and remote columns now match, except 20261117000000 and 20261118000000
   ```
   Do not use `db pull` to bring old migrations into the repository: they would run on staging and collide with the baseline. The legacy files stay in `backend/supabase/migrations_legacy/`.
5. `20261117000000_auth_college_domain_and_new_user_triggers.sql` and `20261118000000_restrict_captain_update_team_member.sql` are then the only pending production migrations, applied by the workflow (see "Migrations in this release").

### Comparison outcomes
| Result | What it means | Next gate |
|---|---|---|
| Identical, or cosmetic differences only | Production already equals the baseline | After the manual export, you mark `20261106000000` and `20261106180125` as applied (repair, history rows only); CI then applies only `20261117000000` and `20261118000000` |
| Production has extra objects | Hand-made additions not in the repository | Either absorb them into the baseline before its first hosted run (needs a local database rebuild, which removes local-only accounts unless exported first) or leave them and document them for later cleanup |
| The baseline has objects production lacks | Marking the baseline applied would be false | A small reconcile migration, reviewed first, applied through CI after the export |
| Different function bodies or policies | Behavioural drift | Review which is correct; nothing is changed automatically |
Also confirm migration `20261117000000` is safe against production's real `enforce_college_domain()`, `handle_new_user()` and `auth.users` triggers, which the inventory includes.

**Result of the comparison (production export vs local inventory):** production matched the baseline on every table, column, RLS flag, index, policy and view. Differences were cosmetic (three CHECK constraints printed differently by Postgres 17.11 and 17.6), production's two auth functions were exactly the baseline text, and the other differences came from the local stack or from the new auth migration. No baseline change and no reconcile migration is needed.

## Migrations in this release
| Migration | What it does | Rollback |
|---|---|---|
| `20261117000000_auth_college_domain_and_new_user_triggers` | Stricter case-insensitive college-domain check, an email-change guard, profile and default-role triggers on `auth.users` | `docs/rollback/auth-college-domain-rollback.sql` |
| `20261118000000_restrict_captain_update_team_member` | Closes an exposure found in production: the 7-argument `captain_update_team_member` ran as its owner, checked nothing about the caller, had no pinned `search_path`, and was executable by `anon` and `PUBLIC`, so anyone with the publishable key could overwrite any registration member (including the email). Afterwards a captain must be **assigned to the player's team and hold the captain role**, a dictator may update any team, everyone else is refused; captains cannot change the email, the `search_path` is pinned, and `anon`/`PUBLIC` lose EXECUTE on both overloads. **Safety guard:** the migration stops without changing anything if any assigned captain lacks the captain role (see below) | **Forward-only.** Do not restore the old definition, which reopens the exposure. If captains report problems, fix forward or revert the frontend change, not the function |

Until `20261118000000` reaches production, production is still exposed. The same merge deploys the matching frontend change (the team builder no longer sends or edits an email and no longer hides a rejected save behind a silent fallback), which also works with the old database function.

## Closing the team member function exposure: exact steps

The repository work is finished and tested locally. The steps below need you (GitHub settings, secrets, a file export, a production approval). Do them in order; each is a gate.

**Before anything: GitHub settings**
1. Environment `Database Production` → **Required reviewers**: add yourself. (Today it has branch restriction `main` and the right secrets, but no reviewer, so a push to `main` would apply to production unattended.)
2. `Database Preview` and `Database Production` already have the right branch rules, secrets (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`) and variable (`SUPABASE_PROJECT_REF`), and `PRODUCTION_PROJECT_REF` is set.

**Staging rehearsal (no production involved)**
3. Push `develop`. The workflow's `verify` job proves the migrations on an empty local database; the `Database Preview` job applies all four migrations and the seed to the staging project.
4. In the **staging** SQL Editor run `scripts/sql/verify-captain-rpc.sql` (read-only): every row must say `t`.
5. From any terminal: `node scripts/verify-rpc-closed.mjs <staging project URL> <staging publishable key>` (Project Settings → API; the publishable key is public) must print `RESULT: CLOSED`.
6. Optional, in the staging app: sign in as the seeded captain and save a player (works); the team builder shows the stored email read-only.

**Production: before the merge**
7. **See the exposure for yourself, harmlessly:** `node scripts/verify-rpc-closed.mjs <production URL> <production publishable key>`. It uses a random player id, so it changes nothing. Before the fix it should print `OPEN` for the 7-argument overload.
8. **Captain role audit (read-only):** run `scripts/sql/captain-role-audit.sql` in the **production** SQL Editor. It lists team entries whose assigned captain does not hold the captain role. Share only the count and the role values. If it returns **no rows**, go on to step 10.
9. **If it returns rows, resolve them deliberately** (the migration refuses to run otherwise, rather than locking a real captain out or granting roles automatically). For each person who really is the captain, assign the role, then re-run the audit until it is empty. Run this only after reviewing the list (one person per uuid; only a `default` role is changed, any other role needs a separate decision):
   ```sql
   UPDATE public.user_roles SET role = 'captain'
   WHERE user_id IN ('<captain_id from the audit>', '<another>') AND role = 'default';
   -- a person with no role row at all:
   -- INSERT INTO public.user_roles (user_id, role) VALUES ('<captain_id>', 'captain') ON CONFLICT (user_id) DO UPDATE SET role = 'captain' WHERE public.user_roles.role = 'default';
   ```
10. **Manual export, then the migration history repair**, exactly as in "Before production runs for the first time" above.
11. **Merge `develop` into `main`** through a pull request and approve the `Database Production` job. It prints a dry run (it must list `20261117000000` and `20261118000000` only; if it lists the baseline, the stop-guard fails the job and the history repair was not done).

**Production: verify the fix**
12. In the production SQL Editor run `scripts/sql/verify-captain-rpc.sql`: every row `t`.
13. Run the probe again: `node scripts/verify-rpc-closed.mjs <production URL> <production publishable key>` must now print `RESULT: CLOSED` (it said `OPEN` in step 7).
14. Sign in to the production app as a real captain and save a player (works); as a different user you cannot change another team's player.

**If the migration stops at the guard:** it changed nothing. The message gives a count; return to steps 8 and 9, then run the `Database deploy` workflow again.

## First run, in order (each step needs your approval)
1. Staging created empty, GitHub environments and secrets set, laptop relinked to staging.
2. **Push `develop`.** The `staging` job applies all four migrations and the seed. Check staging: `supabase_migrations.schema_migrations` lists four versions and the fixture rows exist.
3. Work through the staging checks in `docs/auth.md`.
4. Complete "Before production runs for the first time", and the captain role audit in "Closing the team member function exposure".
5. **Merge `develop` into `main`** through a pull request. The `production` job waits for your approval, prints a dry run in its summary, then applies only `20261117000000` and `20261118000000`. The same merge also triggers the Pages production build: the new frontend works with the old database triggers, and CAPTCHA stays off until you enable it, so set the Pages site key before enabling CAPTCHA (see `docs/auth.md`).

## Manual runs
Actions → *Database deploy* → Run workflow on `develop` or `main`. It defaults to a **dry run** that only prints pending migrations; untick the box to apply.

## Preview seed, refresh and reports
After the migrations, the `staging` job runs, in order: `scripts/preview-seed.sh seed` (the existing `backend/supabase/seed.sql`, in its own transaction), `scripts/preview-seed.sh verify` (read-only checks: `scripts/sql/verify-preview.sql` and `scripts/sql/verify-captain-rpc.sql`, any `false` fails the job), and a public API probe (`scripts/verify-rpc-closed.mjs`, skipped and reported as skipped unless the `PREVIEW_PUBLISHABLE_KEY` variable is set in `Database Preview`; the publishable key is public by design). The script refuses unless the project reference differs from production's, equals the linked project, and the connection address is that project's pooler. The database password only reaches `psql` as `PGPASSWORD`.

- **Reading the result:** the run's summary shows `Seed: PASSED`, a row count per table, every check as PASS or FAIL, `Verification: PASSED (n checks)` and the probe result.
- **Refreshing fixtures:** run the workflow again on `develop` (push, or Run workflow with dry run unticked). Rows are never duplicated (fixed ids). Time-dependent match state is refreshed: the live matches and upcoming fixtures re-anchor to the run time, and fixture match scores are restored. Everything else keeps `ON CONFLICT DO NOTHING`, so a tester's edits to teams, players and so on survive. The local seed behaves the same way.
- **Production:** the `production` job contains no seed, `psql` or Preview step, and a test asserts that. Never use `supabase db reset --linked`: it would wipe the project.
- **Fixture accounts cannot sign in** (no password), so Preview tests that need a signed-in role use real accounts you create and assign yourself.

## If something fails
- **Staging job fails:** nothing in production is affected. Fix forward with a new migration. A paused project (resume it) or a network error from the runner (free-plan direct connections can be IPv6-only; tell the assistant to add the pooler connection) are the usual causes.
- **`FATAL: password authentication failed` at "Preview pending migrations" (or the production equivalent):** the *Link* and *Verify the linked project* steps passed, so the access token and project reference are right; the `SUPABASE_DB_PASSWORD` secret in that GitHub environment does not match the project's database password. Reset the database password in Supabase (Project Settings → Database), use a long alphanumeric one so no character needs URL-encoding, update the secret in the **same** environment (`Database Preview` for staging, `Database Production` for production), then re-run the failed job. Never paste the password anywhere else.
- **CI frontend tests crash on the runner but pass locally:** compare `.nvmrc` with your local Node. The tooling test `node-version.test.ts` checks that `.nvmrc` satisfies every installed dependency's Node requirement.
- **Production job fails:** each migration runs in a transaction, so a failing one changes nothing. Read the job log, fix forward with a new migration, and use `docs/rollback/` for the auth triggers if needed.
- **Seed refuses to run:** the seed aborts if the database has more than 20 accounts outside its own fixtures. That is the safeguard against seeding real data; it should never trigger on staging.
- **Rolling back:** database changes are forward-fix only, backed by your manual export. There is no automatic revert.

## Player identity and season rosters (2026-11-18)

- **What changes:** migrations `20261124000000_player_identity_rosters.sql` (expand) and `20261125000000_retire_team_bound_rosters.sql` (contract) turn players into reusable identities with season roster places and retire the Freshers member table. They also replace `captain_update_team_member` with `captain_update_roster_player`. The mapping is in `docs/decisions/SL-021-player-identity-mapping.md`.
- **Before the `main` release:** run `scripts/sql/roster-mapping-dryrun.sql` on a **local restore** of production. It must list no blockers. Review each linked member's replaced values. The migration stops by itself on any blocker and changes nothing.
- **Rehearsal (local only):** `pnpm db:rehearse-rosters --yes` rebuilds the local database from the pre-SL-021 schema, its seed and edge cases, applies both migrations and checks the result and the stop path, then resets normally.
- **The anonymous probe** (`scripts/verify-rpc-closed.mjs`) now checks `captain_update_roster_player` and the two retired overloads:
  - after these migrations it prints `roster player ... CLOSED`, and `RETIRED` for both old overloads;
  - before them, the roster function does not exist yet, so it reports `INCONCLUSIVE`.
- **The staging deploy's read-only check** `scripts/sql/verify-captain-rpc.sql` expects the new function and the old overloads gone.

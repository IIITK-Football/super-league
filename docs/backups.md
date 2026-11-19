# Production database backups

Production runs on Supabase's Free plan, which keeps no backups and no point-in-time recovery. These backups are the
only copies. Every one is a full `pg_dump` (custom format) of the production database, proven restorable, encrypted
to the owner's age key and stored in the private R2 bucket `backup`.

## When backups are made
| When | How | Object prefix |
|---|---|---|
| **Every production migration** (mandatory gate) | `db-deploy.yml`, job `production-backup`, before the `production` job | `automated-prod/pre-migration/` |
| Every day, 03:00 IST (21:30 UTC) | `db-backup.yml`, schedule on `main` | `automated-prod/scheduled/` |
| **Before any manual production SQL change** | Actions → "Database backup" → Run workflow on `main`, target `production`, with a note | `automated-prod/manual/` |
| Staging rehearsal | Actions → "Database backup", target `staging-rehearsal`, or a push to `develop` that changes the backup tooling | `automated-staging-test/rehearsal/` |
| A backup whose restore test failed | any of the above; the run fails | `<prefix>/unverified/` |

Each object `<prefix>/<reason>/<UTC time>-<run id>-<attempt>.dump.age` has a `.manifest.json` beside it. The manifest
records the target, reason, note, sha256, sizes, versions, the migration history, the restore-test result and the row
count of every public table, Auth accounts and identities.

## What every backup run does
The steps are in `scripts/backup/database-backup.sh`, called by the composite action `.github/actions/database-backup`.
1. **Guards (before anything is contacted):**
   - the URL is a Session pooler URI naming the expected project;
   - production uses `PRODUCTION_PROJECT_REF`, and the rehearsal only the staging project;
   - the bucket is `backup` and the endpoint is R2;
   - the age key is well formed.
2. **Dump** through the Session pooler with the read-only role `backup_reader` (`BYPASSRLS`, `pg_read_all_data`); vault secret values are excluded.
3. **Archive check:** the archive lists and contains players, profiles, Auth accounts and identities.
4. **Restore test:** a disposable Supabase stack on the runner receives:
   - the public schema, its triggers and the migration history;
   - the data of every public table, the Auth accounts and identities.
   
   Every table's row count must equal production's, read just before and after the dump, and the migration history must match.
5. **Encrypt** with `age` to the repository variable `BACKUP_AGE_RECIPIENT`. Only the owner's offline private key decrypts.
6. **Upload, then read back** the object and manifest: the sha256 and size must match.
7. **Job summary:**
   - backup completed;
   - restore test;
   - uploaded object verified;
   - key, size, checksum;
   - for a pre-migration backup: **Production migration permitted: yes/no**.

Logs show only keys, sizes, checksums, counts and verdicts. The repository is public, so nothing is ever an Actions
artifact and no URL or password is printed.

## The pre-migration gate (how a production migration is blocked)
`db-deploy.yml` on `main`:
1. **`verify`:** the migrations are proven on an empty local database.
2. **`production-backup`** (environment Database Backup, no reviewer): makes the backup above, with reason `pre-migration`.
   **If anything fails, the job fails and the `production` job is skipped**: no approval is requested and no migration starts.
3. **`production`** (environment Database Production) needs `verify` and `production-backup`, so GitHub asks for the reviewer's approval only after a verified backup exists.
4. **After approval,** its step **Confirm the pre-migration backup** (`scripts/backup/confirm-backup.sh`) runs before it links to the project. It downloads the same object again, checks the sha256 and the manifest (production, pre-migration, restore test passed), and requires the backup to be **at most 6 hours old**. It then prints **Production migration permitted: yes**. Anything else fails the job before `supabase link` and `db push`.

No input, variable or `continue-on-error` skips any of this (asserted by `backend/tests/tooling/production-backup-gate.test.ts`).
If the approval comes more than 6 hours after the backup, run the workflow again for a fresh backup.

## Configuration
| Where | Name | Purpose |
|---|---|---|
| Environment Database Backup (branch `main`) | `PRODUCTION_BACKUP_DB_URL` | Session pooler URI of `backup_reader` on production |
| | `STAGING_BACKUP_DB_URL` | Session pooler URI on staging (rehearsal only) |
| | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT` | Token with object read and write on `backup` |
| Environment Database Production | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT` | Reads the backup back for the confirmation step |
| Repository variables | `BACKUP_AGE_RECIPIENT`, `PRODUCTION_PROJECT_REF` | Encryption key; production project guard |
| R2 bucket `backup` | Lifecycle rule: delete `automated-prod/` objects after 180 days; bucket lock 30 days | Retention |

`develop` was allowed on Database Backup only for the staging rehearsal. Remove it afterwards, so only `main` reaches
the production URL.

## Retention and cost
- **Retention:** objects live 180 days (lifecycle rule). For their first 30 days they cannot be deleted or overwritten (bucket lock). Keys are unique, so nothing is overwritten anyway.
- **Size and cost:**
  - an encrypted backup is about 1 MB today; daily backups for 180 days plus manual and pre-migration ones come to about 0.2–0.3 GB, about 3% of R2's free 10 GB-month;
  - about 4 writes and 3 reads per run, against free monthly allowances of 1M and 10M operations;
  - egress is free;
  - GitHub Actions minutes are free for this public repository, about 5–8 minutes per run.
- **Supabase:** a few MB of database egress per run, within the Free plan.
- **Schedules:** GitHub disables scheduled workflows in public repositories after 60 days without activity. Re-enable "Database backup" from the Actions tab if that happens.

## When something fails
| Failure | What happens | What to do |
|---|---|---|
| Pre-migration backup (dump, restore test, upload, read-back) | `production-backup` fails; summary says "permitted: no"; `production` is skipped, no approval request | Fix the cause (the summary and log say which step), then run the workflow again |
| Confirmation after approval (missing, changed, stale or unverified backup) | `production` fails before `supabase link` | Run the workflow again for a fresh backup |
| Scheduled backup | The run fails and GitHub emails you; the next attempt is the next night | Check the log; start a manual backup once fixed |
| Manual backup | No verified backup | Do not run the manual SQL until a manual backup succeeds |
| Restore test | The encrypted file is stored under `unverified/` for diagnosis; the run fails | Investigate with a restore drill of that object |

## Restore drill (owner, local only; monthly and before every production cutover)
```bash
# Read-only token on the backup bucket, in your shell only:
export R2_ENDPOINT=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
bash scripts/backup/restore-drill.sh automated-prod/scheduled/<time>-<run>.dump.age ~/path/to/age-key.txt --fresh
```
The drill:
- downloads the backup and checks it against its manifest;
- decrypts it with your private key;
- recreates the isolated clone's database (`~/sl-prod-clone`, Postgres 127.0.0.1:56322 only; it refuses anything else);
- restores the backup, sanitizing it inside the load transaction (`scripts/sql/clone-sanitize.sql`);
- compares every table's row count with the manifest.

It never connects to production. Inspect the result in Studio at http://127.0.0.1:56323.

## Recovering production (owner only; never automatic)
1. Stop writes to the app. Run a **manual backup** of the current state, even if it's damaged.
2. Choose the backup to recover from, and **drill it** into the clone first. Confirm the data you need is there.
3. Decrypt it locally: `age -d -i <key> -o restore.dump <object>.dump.age`. Keep `restore.dump` on an encrypted disk and delete it afterwards.
4. **Lost or damaged rows in a few tables:**
   - restore the backup into a scratch database (the clone);
   - extract exactly the affected rows (`pg_restore --data-only -t <table>` or SQL in the clone);
   - review them;
   - apply them to production in **one transaction** in the SQL Editor;
   - verify the counts.
5. **Total loss:** create a new Supabase project, restore the whole archive with `pg_restore` (Supabase's restore-from-dump guidance), verify it against the manifest's counts, then point the app at the new project.
6. Record what was restored and why.

No workflow restores to production. A restore is always a manual, reviewed act.

## One-time setup (done 2026-11-20)
The read-only role, created by the owner in the production SQL Editor:
```sql
CREATE ROLE backup_reader LOGIN BYPASSRLS PASSWORD '<secret>';
GRANT pg_read_all_data TO backup_reader;
```
Its Session pooler URI is `postgresql://backup_reader.<project ref>:<secret>@<pooler host>:5432/postgres`.

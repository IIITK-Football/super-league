#!/usr/bin/env bash
# Database backup: dump, check, restore-test, encrypt, upload, read back. Used by .github/actions/database-backup.
#
#   TARGET        production | staging            (staging is only the rehearsal target)
#   REASON        pre-migration | scheduled | manual | rehearsal
#   NOTE          free text for the manifest (optional)
#   DB_URL        Session pooler URI; its user is <role>.<project ref>
#   EXPECTED_REF  the project ref the URL must name (production: the PRODUCTION_PROJECT_REF variable)
#   PRODUCTION_REF the production ref (a staging run refuses it)
#   AGE_RECIPIENT age public key; only the matching offline private key can decrypt
#   R2_BUCKET R2_ENDPOINT AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY   the private backup bucket
#   SUPABASE_BIN  Supabase CLI used for the disposable restore-test stack
#   BACKUP_STORE_DIR  tests only: a local directory instead of R2 (refused on GitHub Actions)
#
# Objects: production -> automated-prod/<reason>/<UTC time>-<run>.dump.age (+ .manifest.json)
#          staging    -> automated-staging-test/<reason>/...
#          a failed restore test -> <prefix>/unverified/... and the run fails.
# Logs and the job summary show keys, sizes, checksums, counts and verdicts only: never a URL, a password or data.
set -euo pipefail

STAGING_REF='yecozsiccsfwphlmxozt'
summary_lines=()
verdict_backup='no'
verdict_verified='no'
verdict_restore='not run'
key=''
sha=''
size=''
fail() { echo "BACKUP FAILED: $*" >&2; write_summary; exit 1; }
note_summary() { summary_lines+=("$1"); }
# The job summary file on GitHub Actions; standard output elsewhere (opening /dev/stdout fails when it is a socket).
summary_sink() { if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then cat >> "$GITHUB_STEP_SUMMARY"; else cat; fi; }
write_summary() {
  local permitted='no'
  [ "$verdict_backup" = 'yes' ] && [ "$verdict_verified" = 'yes' ] && permitted='yes'
  {
    echo "### Database backup (${TARGET:-?}, ${REASON:-?})"
    echo
    echo "| Check | Result |"
    echo "|---|---|"
    echo "| Backup completed | ${verdict_backup} |"
    echo "| Restore test | ${verdict_restore} |"
    echo "| Uploaded object verified (read back, sha256) | ${verdict_verified} |"
    [ -n "$key" ] && echo "| Object | \`${R2_BUCKET_LABEL:-backup}/${key}\` |"
    [ -n "$size" ] && echo "| Encrypted size | ${size} bytes |"
    [ -n "$sha" ] && echo "| sha256 | \`${sha}\` |"
    for l in "${summary_lines[@]+"${summary_lines[@]}"}"; do echo "$l"; done
    if [ "${REASON:-}" = 'pre-migration' ]; then
      echo
      echo "**Production migration permitted: ${permitted}**"
    fi
  } | summary_sink
  if [ "${REASON:-}" = 'pre-migration' ]; then echo "Production migration permitted: ${permitted}"; fi
}

# --- Guards (nothing is contacted before these pass) ---------------------------------------------------------------
case "${TARGET:-}" in production|staging) ;; *) TARGET="${TARGET:-}"; fail "TARGET must be production or staging" ;; esac
case "${REASON:-}" in pre-migration|scheduled|manual|rehearsal) ;; *) fail "REASON must be pre-migration, scheduled, manual or rehearsal" ;; esac
[ "$TARGET" = 'staging' ] && [ "$REASON" != 'rehearsal' ] && fail "staging is only the rehearsal target"
[ "$TARGET" = 'production' ] && [ "$REASON" = 'rehearsal' ] && fail "a rehearsal never targets production"
[ -n "${DB_URL:-}" ] || fail "DB_URL is not set"
[ -n "${EXPECTED_REF:-}" ] || fail "EXPECTED_REF is not set"
[ -n "${PRODUCTION_REF:-}" ] || fail "PRODUCTION_REF is not set"
if [[ "$DB_URL" =~ ^postgres(ql)?://([^:@/]+)\.([a-z0-9]{20}):([^@]*)@([^/:@]+)(:[0-9]+)?/([A-Za-z0-9_]+)$ ]]; then
  url_ref="${BASH_REMATCH[3]}"
  url_password="${BASH_REMATCH[4]}"
  [ -n "${GITHUB_ACTIONS:-}" ] && [ -n "$url_password" ] && echo "::add-mask::${url_password}"
else
  fail "DB_URL is not a Session pooler URI of the form postgresql://<role>.<project ref>:<password>@<host>:<port>/<db>"
fi
[ "$url_ref" = "$EXPECTED_REF" ] || fail "the database URL names a different project than expected"
if [ "$TARGET" = 'production' ]; then
  [ "$EXPECTED_REF" = "$PRODUCTION_REF" ] || fail "production backups must target the production project"
  prefix='automated-prod'
else
  [ "$EXPECTED_REF" = "$STAGING_REF" ] || fail "the rehearsal must target the staging project"
  [ "$url_ref" != "$PRODUCTION_REF" ] || fail "the rehearsal refuses the production project"
  prefix='automated-staging-test'
fi
[[ "${AGE_RECIPIENT:-}" =~ ^age1[0-9a-z]{58}$ ]] || fail "AGE_RECIPIENT is not an age public key"
if [ -n "${BACKUP_STORE_DIR:-}" ]; then
  [ -z "${GITHUB_ACTIONS:-}" ] || fail "BACKUP_STORE_DIR is for local tests only"
  R2_BUCKET_LABEL='local-test-store'
else
  [ "${R2_BUCKET:-}" = 'backup' ] || fail "R2_BUCKET is not the backup bucket"
  [[ "${R2_ENDPOINT:-}" =~ ^https://[0-9a-f]{32}\.r2\.cloudflarestorage\.com/?$ ]] || fail "R2_ENDPOINT is not an R2 S3 endpoint"
  [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ] || fail "the R2 credentials are not set"
  R2_BUCKET_LABEL='backup'
fi
echo "Guards passed: target ${TARGET}, project matches, bucket is ${R2_BUCKET_LABEL}, age recipient is valid."

work="$(mktemp -d)"
chmod 700 "$work"
stack=''
cleanup() {
  if [ -n "$stack" ]; then "${SUPABASE_BIN:?}" stop --workdir "$stack" --no-backup >/dev/null 2>&1 || true; fi
  rm -rf "$work" "$stack"
}
trap cleanup EXIT

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
run="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"

# shellcheck source=scripts/backup/restore-lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/restore-lib.sh"
counts() { backup_counts "$1"; }
migration_head() { backup_migration_head "$1"; }

# --- 1. Dump -----------------------------------------------------------------------------------------------------
echo "Dumping the ${TARGET} database (custom format)..."
counts "$DB_URL" > "$work/live-before.txt" || fail "could not read row counts from the database"
live_head="$(migration_head "$DB_URL")"
server_version="$(psql "$DB_URL" -X -A -t -c 'SHOW server_version' 2>/dev/null | cut -d' ' -f1 || echo unknown)"
pg_dump --format=custom --compress=9 --exclude-table-data='vault.secrets' --file="$work/db.dump" "$DB_URL" \
  || fail "pg_dump failed"
counts "$DB_URL" > "$work/live-after.txt" || fail "could not read row counts after the dump"
chmod 600 "$work/db.dump"
plain_size="$(wc -c < "$work/db.dump" | tr -d ' ')"
tables="$(wc -l < "$work/live-before.txt" | tr -d ' ')"
echo "Dump written: ${plain_size} bytes; ${tables} tables counted."

# --- 2. Archive check ----------------------------------------------------------------------------------------------
pg_restore --list "$work/db.dump" > "$work/toc.txt" || fail "the archive cannot be listed"
for required in 'TABLE DATA public players' 'TABLE DATA public user_profiles' 'TABLE DATA auth users' 'TABLE DATA auth identities'; do
  grep -qE "^[0-9]+; [0-9]+ [0-9]+ ${required} " "$work/toc.txt" || fail "the archive has no ${required#TABLE DATA }"
done
echo "Archive check passed: the archive lists its contents, including players, profiles and Auth accounts."

# --- 3. Restore test on a disposable local stack ---------------------------------------------------------------------
restore_ok='no'
restore_test() {
  stack="$(mktemp -d)"
  "${SUPABASE_BIN:?}" init --workdir "$stack" >/dev/null 2>&1 || return 1
  local cfg="$stack/supabase/config.toml"
  perl -pi -e 's/^project_id = .*/project_id = "sl-backup-restore-test"/; s/\b543(\d\d)\b/573$1/g' "$cfg"
  perl -0pi -e 's/(\[db\]\n(?:(?!\n\[).)*?)major_version = \d+/${1}major_version = 17/s' "$cfg"
  perl -0pi -e 's/(\[db\.seed\]\n(?:(?!\n\[).)*?)enabled = true/${1}enabled = false/s' "$cfg"
  "${SUPABASE_BIN:?}" start --workdir "$stack" \
    -x realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor \
    --ignore-health-check > "$work/stack.log" 2>&1 || { grep -viE 'key|secret|jwt|password' "$work/stack.log" | tail -5 >&2; return 1; }
  local target='postgresql://postgres:postgres@127.0.0.1:57322/postgres'
  psql "$target" -X -A -t -c 'SELECT 1' >/dev/null || return 1
  restore_archive "$target" "$work/db.dump" "$work" || return 1
  counts "$target" > "$work/restored.txt" || return 1
  restored_head="$(migration_head "$target")"
  return 0
}
restored_head='unknown'
if restore_test; then
  # Every table's restored rows must equal the live count; if the live count moved during the dump, it must lie
  # between the counts before and after.
  mismatch="$(LC_ALL=C join -t '|' -a1 -e MISSING -o 0,1.2,2.2 <(LC_ALL=C sort "$work/live-before.txt") <(LC_ALL=C sort "$work/restored.txt") \
    | LC_ALL=C join -t '|' -a1 -e MISSING -o 0,1.2,1.3,2.2 - <(LC_ALL=C sort "$work/live-after.txt") \
    | awk -F'|' '{ lo=($2<$4)?$2:$4; hi=($2>$4)?$2:$4; if ($3=="MISSING" || $3<lo || $3>hi) print $1 }')"
  if [ -z "$mismatch" ] && { [ "$restored_head" = "$live_head" ] || [ "$live_head" = 'none' ]; }; then
    restore_ok='yes'
    verdict_restore="passed (${tables} tables match; migration history: ${restored_head})"
  else
    verdict_restore="FAILED (count or history mismatch: $(echo "$mismatch" | head -5 | tr '\n' ' ') history live=${live_head} restored=${restored_head})"
  fi
else
  verdict_restore='FAILED (the archive could not be restored into a disposable database)'
fi
echo "Restore test: ${verdict_restore}"

# --- 4. Encrypt, upload, read back -----------------------------------------------------------------------------------
age -r "$AGE_RECIPIENT" -o "$work/db.dump.age" "$work/db.dump" || fail "encryption failed"
rm -f "$work/db.dump"
sha="$(shasum -a 256 "$work/db.dump.age" | cut -d' ' -f1)"
size="$(wc -c < "$work/db.dump.age" | tr -d ' ')"
folder="$REASON"
[ "$restore_ok" = 'yes' ] || folder='unverified'
key="${prefix}/${folder}/${stamp}-${run}.dump.age"
manifest_key="${key%.dump.age}.manifest.json"
jq -n --arg target "$TARGET" --arg reason "$REASON" --arg note "${NOTE:-}" --arg key "$key" --arg sha "$sha" \
  --arg created "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg run "${GITHUB_RUN_ID:-local}" --arg commit "${GITHUB_SHA:-local}" \
  --arg pgdump "$(pg_dump --version | awk '{print $3}')" --arg server "$server_version" \
  --argjson plain "$plain_size" --argjson enc "$size" --argjson restored "$([ "$restore_ok" = yes ] && echo true || echo false)" \
  --arg restore "$verdict_restore" --arg history "$live_head" --argjson tables "$tables" \
  --argjson counts "$(jq -R -s 'split("\n") | map(select(length > 0) | split("|") | {(.[0]): (.[1] | tonumber)}) | add // {}' "$work/live-after.txt")" \
  '{target:$target, reason:$reason, note:$note, key:$key, sha256:$sha, created_at:$created, run_id:$run, commit:$commit,
    pg_dump:$pgdump, server_version:$server, plain_bytes:$plain, encrypted_bytes:$enc, restore_test_passed:$restored,
    restore_test:$restore, migration_history:$history, tables_counted:$tables, row_counts:$counts}' > "$work/manifest.json"
store_put() {
  if [ -n "${BACKUP_STORE_DIR:-}" ]; then mkdir -p "$BACKUP_STORE_DIR/$(dirname "$2")" && cp "$1" "$BACKUP_STORE_DIR/$2"
  else aws s3 cp --only-show-errors --endpoint-url "$R2_ENDPOINT" "$1" "s3://${R2_BUCKET}/$2"; fi
}
store_get() {
  if [ -n "${BACKUP_STORE_DIR:-}" ]; then cp "$BACKUP_STORE_DIR/$1" "$2"
  else aws s3 cp --only-show-errors --endpoint-url "$R2_ENDPOINT" "s3://${R2_BUCKET}/$1" "$2"; fi
}
export AWS_DEFAULT_REGION=auto AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
store_put "$work/db.dump.age" "$key" || fail "upload of the backup failed"
store_put "$work/manifest.json" "$manifest_key" || fail "upload of the manifest failed"
echo "Uploaded ${key} (${size} bytes)."
verdict_backup="$restore_ok"

store_get "$key" "$work/readback.age" || fail "the uploaded backup could not be read back"
store_get "$manifest_key" "$work/readback.json" || fail "the uploaded manifest could not be read back"
rb_sha="$(shasum -a 256 "$work/readback.age" | cut -d' ' -f1)"
rb_size="$(wc -c < "$work/readback.age" | tr -d ' ')"
if [ "$rb_sha" = "$sha" ] && [ "$rb_size" = "$size" ] && [ "$(jq -r .sha256 "$work/readback.json")" = "$sha" ]; then
  verdict_verified='yes'
  echo "Read-back verification passed: the stored object's sha256 and size match, and its manifest names it."
else
  fail "read-back verification failed: the stored object does not match what was uploaded"
fi

note_summary "| Tables counted | ${tables} |"
note_summary "| Migration history | ${live_head} |"
[ -n "${NOTE:-}" ] && note_summary "| Note | ${NOTE//|/\\|} |"
write_summary
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  { echo "key=${key}"; echo "sha256=${sha}"; echo "created_at=$(jq -r .created_at "$work/manifest.json")"; } >> "$GITHUB_OUTPUT"
fi
[ "$restore_ok" = 'yes' ] || { echo "BACKUP FAILED: the restore test did not pass; the object is under ${prefix}/unverified/." >&2; exit 1; }
echo "Backup complete and verified: ${key}"

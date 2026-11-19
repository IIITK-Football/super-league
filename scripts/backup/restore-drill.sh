#!/usr/bin/env bash
# Restore drill (owner, local only): proves an encrypted backup in R2 can be decrypted with the offline private key and
# restored, by restoring it into the isolated local clone and comparing its row counts with the backup's manifest.
# It never connects to a hosted database and is refused on GitHub Actions.
#
#   bash scripts/backup/restore-drill.sh <object key> <age identity file> [--fresh]
#
# Needs, in your shell (never in the repository): R2_ENDPOINT, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY of a
# read-only token on the "backup" bucket. The clone is the separate local Supabase project in CLONE_WORKDIR (default
# ~/sl-prod-clone), whose Postgres must be 127.0.0.1:56322 (Studio 127.0.0.1:56323). --fresh recreates the clone's
# database first (it is disposable); without it the clone's public schema must be empty. Data is sanitized inside the
# load transaction (scripts/sql/clone-sanitize.sql). Prints counts and verdicts only.
#   BACKUP_STORE_DIR  tests only: a local directory instead of R2
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
# shellcheck source=scripts/backup/restore-lib.sh
. "$here/restore-lib.sh"

key="${1:-}"; identity="${2:-}"; fresh="${3:-}"
die() { echo "RESTORE DRILL FAILED: $*" >&2; exit 1; }
[ -z "${GITHUB_ACTIONS:-}" ] || die "the drill runs on your machine only"
[[ "$key" =~ ^automated-(prod|staging-test)/[a-z-]+/[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9-]+\.dump\.age$ ]] || die "give the object key of a backup (automated-prod/... or automated-staging-test/...)"
[ -f "$identity" ] || die "give the path of your age identity (private key) file"
[ -z "$fresh" ] || [ "$fresh" = '--fresh' ] || die "the third argument may only be --fresh"
clone="${CLONE_WORKDIR:-$HOME/sl-prod-clone}"
target='postgresql://postgres:postgres@127.0.0.1:56322/postgres'
supabase="$repo/node_modules/.bin/supabase"

status_url() { "$supabase" status --workdir "$clone" -o json 2>/dev/null | sed -n 's/.*"DB_URL": *"\([^"]*\)".*/\1/p'; }
case "$(status_url)" in *@127.0.0.1:56322/*) ;; *) die "the clone in ${clone} is not running on 127.0.0.1:56322 (start it with: pnpm exec supabase start --workdir ${clone})" ;; esac
if [ "$fresh" = '--fresh' ]; then
  echo "Recreating the clone's database (disposable)..."
  "$supabase" stop --workdir "$clone" --no-backup >/dev/null 2>&1 || die "could not stop the clone"
  "$supabase" start --workdir "$clone" >/dev/null 2>&1 || die "could not start the clone"
  case "$(status_url)" in *@127.0.0.1:56322/*) ;; *) die "the clone did not come back on 127.0.0.1:56322" ;; esac
fi
[ "$(psql "$target" -X -A -t -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")" = '0' ] \
  || die "the clone's public schema is not empty; run again with --fresh"

work="$(mktemp -d)"; chmod 700 "$work"; trap 'rm -rf "$work"' EXIT
umask 077
export AWS_DEFAULT_REGION=auto AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
get() {
  if [ -n "${BACKUP_STORE_DIR:-}" ]; then cp "$BACKUP_STORE_DIR/$1" "$2"
  else aws s3 cp --only-show-errors --endpoint-url "${R2_ENDPOINT:?R2_ENDPOINT is not set}" "s3://backup/$1" "$2"; fi
}
get "$key" "$work/backup.age" || die "could not download the backup"
get "${key%.dump.age}.manifest.json" "$work/manifest.json" || die "could not download the manifest"
[ "$(shasum -a 256 "$work/backup.age" | cut -d' ' -f1)" = "$(jq -r .sha256 "$work/manifest.json")" ] || die "the backup does not match its manifest checksum"
echo "Downloaded and checksum verified: ${key}"
age -d -i "$identity" -o "$work/backup.dump" "$work/backup.age" || die "decryption failed (wrong key?)"
rm -f "$work/backup.age"
echo "Decrypted with the offline key."

restore_archive "$target" "$work/backup.dump" "$work" "$repo/scripts/sql/clone-sanitize.sql" || die "the restore failed"
rm -f "$work/backup.dump"
backup_counts "$target" > "$work/restored.txt"
expected="$(jq -r '.row_counts // {} | to_entries[] | "\(.key)|\(.value)"' "$work/manifest.json" | LC_ALL=C sort)"
[ -n "$expected" ] || die "the manifest has no row counts to compare"
mismatch="$(LC_ALL=C join -t '|' -a1 -e MISSING -o 0,1.2,2.2 <(echo "$expected") <(LC_ALL=C sort "$work/restored.txt") | awk -F'|' '$2 != $3 {print $1}')"
[ -z "$mismatch" ] || die "row counts differ from the backup's manifest: $(echo "$mismatch" | head -5 | tr '\n' ' ')"
echo "Restore drill passed: $(echo "$expected" | wc -l | tr -d ' ') tables match the manifest; sanitized data is in the clone (Studio http://127.0.0.1:56323)."

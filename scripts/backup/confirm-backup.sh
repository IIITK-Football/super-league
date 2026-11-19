#!/usr/bin/env bash
# Confirms, inside the production migration job and before anything touches the database, that the pre-migration
# backup made by the production-backup job exists in R2, is intact and is recent enough. Prints the verdict
# "Production migration permitted: yes|no" in the log and the job summary, and fails the job unless it is "yes".
#
#   BACKUP_KEY       object key passed from the production-backup job
#   BACKUP_SHA256    its sha256, passed from the same job
#   MAX_AGE_HOURS    maximum age of the backup when the migration starts (owner decision 2026-11-20: 6)
#   R2_BUCKET R2_ENDPOINT AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY   the private backup bucket
#   BACKUP_STORE_DIR tests only: a local directory instead of R2 (refused on GitHub Actions)
set -euo pipefail

verdict() {
  local permitted="$1" reason="$2"
  {
    echo "### Pre-migration backup confirmation"
    echo
    echo "| Check | Result |"
    echo "|---|---|"
    echo "| Object | \`${BACKUP_KEY:-none}\` |"
    echo "| Result | ${reason} |"
    echo
    echo "**Production migration permitted: ${permitted}**"
  } | if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then cat >> "$GITHUB_STEP_SUMMARY"; else cat; fi
  echo "Production migration permitted: ${permitted} (${reason})"
  [ "$permitted" = 'yes' ] || exit 1
}

[[ "${BACKUP_KEY:-}" =~ ^automated-prod/pre-migration/[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9-]+\.dump\.age$ ]] \
  || verdict no "no pre-migration backup key was passed from the production-backup job"
[[ "${BACKUP_SHA256:-}" =~ ^[0-9a-f]{64}$ ]] || verdict no "no backup checksum was passed"
[[ "${MAX_AGE_HOURS:-}" =~ ^[0-9]+$ ]] || verdict no "MAX_AGE_HOURS is not set"
if [ -n "${BACKUP_STORE_DIR:-}" ]; then
  [ -z "${GITHUB_ACTIONS:-}" ] || verdict no "BACKUP_STORE_DIR is for local tests only"
else
  [ "${R2_BUCKET:-}" = 'backup' ] || verdict no "R2_BUCKET is not the backup bucket"
  [ -n "${R2_ENDPOINT:-}" ] && [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ] || verdict no "the R2 credentials are not set"
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
export AWS_DEFAULT_REGION=auto AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
get() {
  if [ -n "${BACKUP_STORE_DIR:-}" ]; then cp "$BACKUP_STORE_DIR/$1" "$2"
  else aws s3 cp --only-show-errors --endpoint-url "$R2_ENDPOINT" "s3://${R2_BUCKET}/$1" "$2"; fi
}
manifest_key="${BACKUP_KEY%.dump.age}.manifest.json"
get "$BACKUP_KEY" "$work/backup.age" 2>/dev/null || verdict no "the backup object is not in the bucket"
get "$manifest_key" "$work/manifest.json" 2>/dev/null || verdict no "the backup manifest is not in the bucket"
actual="$(shasum -a 256 "$work/backup.age" | cut -d' ' -f1)"
[ "$actual" = "$BACKUP_SHA256" ] || verdict no "the stored backup does not match the checksum recorded when it was made"
[ "$(jq -r .sha256 "$work/manifest.json")" = "$BACKUP_SHA256" ] || verdict no "the manifest names a different checksum"
[ "$(jq -r .target "$work/manifest.json")" = 'production' ] || verdict no "the backup is not of the production database"
[ "$(jq -r .reason "$work/manifest.json")" = 'pre-migration' ] || verdict no "the backup is not a pre-migration backup"
[ "$(jq -r .restore_test_passed "$work/manifest.json")" = 'true' ] || verdict no "the backup did not pass its restore test"
created="$(jq -r .created_at "$work/manifest.json")"
created_epoch="$(date -u -d "$created" +%s 2>/dev/null || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$created" +%s)"
age_seconds=$(( $(date -u +%s) - created_epoch ))
[ "$age_seconds" -ge 0 ] || verdict no "the backup's creation time is in the future"
[ "$age_seconds" -le $(( MAX_AGE_HOURS * 3600 )) ] \
  || verdict no "the backup is $(( age_seconds / 3600 )) hours old (limit ${MAX_AGE_HOURS}); run the workflow again for a fresh backup"
verdict yes "verified: sha256 matches, production pre-migration backup, restore test passed, $(( age_seconds / 60 )) minutes old"

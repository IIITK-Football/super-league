#!/usr/bin/env bash
# Marks the two baseline migrations as already applied on the PRODUCTION Supabase project and checks that exactly the two
# new migrations remain pending. Run by the owner, once, before the first production deploy:
#
#   bash scripts/production-history-repair.sh
#
# It asks for the production connection string with HIDDEN input, verifies that it points at the production project
# (obkxfepdpdufxawhzaen) before changing anything, and stops on any surprise. The string is held only in a shell
# variable: it is never printed, never written to a file and never traced. It changes migration HISTORY rows only (no schema
# or data) and never removes a history row by itself. See docs/release.md ("Before production runs for the first time").
set -euo pipefail

PROD_REF="obkxfepdpdufxawhzaen"
STAGING_REF="yecozsiccsfwphlmxozt"
BASELINES=(20261106000000 20261106180125)
EXPECTED_PENDING=(20261117000000 20261118000000)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/backend"
if [ -n "${PRODUCTION_REPAIR_SUPABASE_CMD:-}" ]; then SB=("$PRODUCTION_REPAIR_SUPABASE_CMD"); else SB=(pnpm exec supabase); fi

die() { echo "production-history-repair: $*" >&2; exit 1; }

# Shows output with the connection string removed, in case the CLI echoes it in an error.
show() { local text="$1"; [ -z "$URL" ] || text="${text//"$URL"/<hidden>}"; printf '%s\n' "$text"; }

URL=""
if [ -t 0 ]; then
  read -rsp "Production connection string (input is hidden): " URL
  echo
else
  read -rs URL || true
fi
[ -n "$URL" ] || die "no connection string given; nothing was changed"

case "$URL" in
  postgresql://*|postgres://*) ;;
  *) die "that is not a PostgreSQL connection string; nothing was changed" ;;
esac

# --- verify the target BEFORE any command runs ---------------------------------------------------------------------
rest="${URL#*://}"
userinfo="${rest%@*}"
hostport="${rest##*@}"
host="${hostport%%[:/]*}"
user="${userinfo%%:*}"

user_ref=""
case "$user" in postgres.*) user_ref="${user#postgres.}" ;; esac

host_ref=""
case "$host" in
  db.*.supabase.co) host_ref="${host#db.}"; host_ref="${host_ref%.supabase.co}" ;;
  *.pooler.supabase.com) ;;
  *) die "the host is not a Supabase database host (local databases and anything else are refused); nothing was changed" ;;
esac

for found in "$user_ref" "$host_ref"; do
  [ -n "$found" ] || continue
  if [ "$found" = "$STAGING_REF" ]; then die "the connection string points at the staging project, which is not the production project ($PROD_REF); nothing was changed"; fi
  if [ "$found" != "$PROD_REF" ]; then die "the connection string points at project ${found:0:6}…, which is not the production project ($PROD_REF); nothing was changed"; fi
done
# The project must be named by the user (pooler) or the host (direct); a string naming neither is refused.
[ -n "$user_ref$host_ref" ] || die "the connection string does not name the production project ($PROD_REF); use the pooler string (user postgres.$PROD_REF) or the direct db.$PROD_REF.supabase.co host; nothing was changed"

echo "Target verified: the production project ($PROD_REF)."
echo "Backup: the owner chose the existing superLeagueBackup (this script does not inspect it)."

# --- repair: history rows only -------------------------------------------------------------------------------------
for version in "${BASELINES[@]}"; do
  echo "Marking $version as applied..."
  out="$("${SB[@]}" migration repair --status applied "$version" --db-url "$URL" 2>&1)" || { show "$out"; die "the repair of $version failed; stopping"; }
  show "$out"
done

# --- check the result ----------------------------------------------------------------------------------------------
list="$("${SB[@]}" migration list --db-url "$URL" 2>&1)" || { show "$list"; die "could not list migrations; stopping"; }
echo "Migration list (local | remote):"
show "$list"

pending=()
remote_only=()
while IFS='|' read -r local_col remote_col _; do
  l="$(echo "${local_col:-}" | tr -d '[:space:]')"
  r="$(echo "${remote_col:-}" | tr -d '[:space:]')"
  case "$l$r" in *[!0-9]*|"") continue ;; esac
  if [ -n "$l" ] && [ -z "$r" ]; then pending+=("$l"); fi
  if [ -z "$l" ] && [ -n "$r" ]; then remote_only+=("$r"); fi
done <<< "$list"

if [ "${#remote_only[@]}" -gt 0 ]; then
  echo "Production has migration history with no local file (remote-only): ${remote_only[*]}" >&2
  die "the result does not match what was expected. Do not revert these automatically; follow docs/release.md and report them."
fi

sorted_pending="$(printf '%s\n' "${pending[@]:-}" | sort | tr '\n' ' ' | sed 's/ $//')"
sorted_expected="$(printf '%s\n' "${EXPECTED_PENDING[@]}" | sort | tr '\n' ' ' | sed 's/ $//')"
if [ "$sorted_pending" != "$sorted_expected" ]; then
  echo "Pending on production: ${sorted_pending:-none}" >&2
  echo "Expected pending:      $sorted_expected" >&2
  die "the result does not match what was expected; stopping before anything else changes."
fi

echo "OK: exactly the two expected migrations are pending on production: $sorted_expected"
echo "The baseline is recorded as applied. Next: merge the release pull request and approve the Database Production job."

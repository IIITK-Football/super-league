#!/usr/bin/env bash
# Marks the two baseline migrations as already applied on the PRODUCTION Supabase project and checks that exactly the two
# new migrations remain pending. Run by the owner, once, before the first production deploy:
#
#   bash scripts/production-history-repair.sh
#
# It asks for the production connection string with HIDDEN input (copy the "Session pooler" string from the Supabase
# dashboard, Connect; the password may be left out or still be the [YOUR-PASSWORD] placeholder, and you are then asked for
# it separately, also hidden). It cleans and normalizes the string (stray quotes and spaces, a password that needs
# percent-encoding, a missing port), verifies that it points at the production project (obkxfepdpdufxawhzaen) BEFORE
# changing anything, and stops on any surprise. The string is held only in a shell variable: it is never printed, never
# written to a file and never traced. It changes migration HISTORY rows only (no schema or data) and never removes a
# history row by itself. See docs/release.md ("Before production runs for the first time").
set -euo pipefail

PROD_REF="obkxfepdpdufxawhzaen"
STAGING_REF="yecozsiccsfwphlmxozt"
BASELINES=(20261106000000 20261106180125)
EXPECTED_PENDING=(20261117000000 20261118000000)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/backend"
if [ -n "${PRODUCTION_REPAIR_SUPABASE_CMD:-}" ]; then SB=("$PRODUCTION_REPAIR_SUPABASE_CMD"); else SB=(pnpm exec supabase); fi

URL=""
die() { echo "production-history-repair: $*" >&2; exit 1; }

# Shows output with the connection string removed, in case the CLI echoes it in an error.
show() { local text="$1"; [ -z "$URL" ] || text="${text//"$URL"/<hidden>}"; printf '%s\n' "$text"; }

# Hidden input from a terminal; from a pipe when there is no terminal (used by the tests).
read_hidden() {
  local prompt="$1" value=""
  if [ -t 0 ]; then
    read -rsp "$prompt" value
    echo >&2
  else
    read -rs value || true
  fi
  printf '%s' "$value"
}

urlencode() {
  local LC_ALL=C s="$1" out="" c i
  for ((i = 0; i < ${#s}; i++)); do
    c="${s:i:1}"
    case "$c" in
      [A-Za-z0-9._~-]) out+="$c" ;;
      *) out+="$(printf '%%%02X' "'$c")" ;;
    esac
  done
  printf '%s' "$out"
}

raw="$(read_hidden "Production connection string (input is hidden): ")"
# Remove carriage returns, surrounding spaces and quotes picked up when pasting.
raw="$(printf '%s' "$raw" | tr -d '\r' | sed -E "s/^[[:space:]\"']+//; s/[[:space:]\"']+\$//")"
[ -n "$raw" ] || die "no connection string given; nothing was changed"

case "$raw" in
  postgresql://*|postgres://*) ;;
  *) die "that is not a PostgreSQL connection string (it must start with postgresql://); nothing was changed" ;;
esac

# --- take the string apart (split on the LAST @ so an unencoded @ in a password cannot confuse the host) ---------------
rest="${raw#*://}"
case "$rest" in *@*) ;; *) die "the connection string has no user part (expected postgres.$PROD_REF); nothing was changed" ;; esac
userinfo="${rest%@*}"
hostpath="${rest##*@}"
user="${userinfo%%:*}"
password=""
case "$userinfo" in *:*) password="${userinfo#*:}" ;; esac

hostport="${hostpath%%/*}"
dbq="postgres"
case "$hostpath" in */*) dbq="${hostpath#*/}"; [ -n "$dbq" ] || dbq="postgres" ;; esac
host="${hostport%%:*}"
port="5432"
case "$hostport" in *:*) port="${hostport#*:}" ;; esac
[ -n "$host" ] || die "the connection string has no host; nothing was changed"
[ -n "$user" ] || die "the connection string has no user (expected postgres.$PROD_REF); nothing was changed"

case "$port" in
  5432) ;;
  6543) die "port 6543 is the transaction-mode pooler, which cannot run migration commands; use the Session pooler string (port 5432) or the direct connection; nothing was changed" ;;
  *) die "unexpected port $port; use 5432 (Session pooler or direct connection); nothing was changed" ;;
esac

# --- verify the target BEFORE any command runs -----------------------------------------------------------------------
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
  if [ "$found" != "$PROD_REF" ]; then die "the connection string points at project ${found:0:6}..., which is not the production project ($PROD_REF); nothing was changed"; fi
done
[ -n "$user_ref$host_ref" ] || die "the connection string does not name the production project ($PROD_REF); use the Session pooler string (user postgres.$PROD_REF) or the direct db.$PROD_REF.supabase.co host; nothing was changed"

echo "Target verified: the production project ($PROD_REF)."
echo "Backup evidence: the existing backup files the owner chose (superLeagueBackup); this script never connects to that project."

# --- the password: from the string, or asked separately; percent-encoded so it cannot break the string -----------------
case "$password" in "["*"]") password="" ;; esac # the dashboard placeholder, e.g. [YOUR-PASSWORD]
if [ -z "$password" ]; then
  password="$(read_hidden "Database password (input is hidden): ")"
  password="$(printf '%s' "$password" | tr -d '\r')"
fi
[ -n "$password" ] || die "no password given; nothing was changed"
if ! printf '%s' "$password" | grep -Eq '%[0-9A-Fa-f]{2}'; then password="$(urlencode "$password")"; fi

URL="postgresql://${user}:${password}@${host}:${port}/${dbq}"
unset raw rest userinfo password

# --- repair: history rows only -------------------------------------------------------------------------------------------
for version in "${BASELINES[@]}"; do
  echo "Marking $version as applied..."
  out="$("${SB[@]}" migration repair --status applied "$version" --db-url "$URL" 2>&1)" || { show "$out"; die "the repair of $version failed; stopping"; }
  show "$out"
done

# --- check the result ------------------------------------------------------------------------------------------------------
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

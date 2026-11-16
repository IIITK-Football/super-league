#!/usr/bin/env bash
# Guarded helper for this repository's project-local Supabase stack (SL-013).
#
# Target: project_id "backend", database 127.0.0.1:54322 (see backend/supabase/config.toml).
# It never uses hosted-project flags, never forwards arbitrary arguments, never touches other
# Docker projects (for example the separate superLeagueBackup stack on 55322), and fails fast.
#
#   scripts/local-db.sh check            verify config + running target (read-only)
#   scripts/local-db.sh status           same, then show service URLs (keys hidden)
#   scripts/local-db.sh start            inspect first, then start this project's stack
#   scripts/local-db.sh stop             stop this project's stack
#   scripts/local-db.sh reset [--yes]    DESTRUCTIVE: rebuild local DB from migrations + seed
#   scripts/local-db.sh test             run pgTAP tests against the local DB
#   scripts/local-db.sh psql             open psql on the verified local DB
set -euo pipefail

EXPECTED_PROJECT="backend"
EXPECTED_PORT="54322"
EXPECTED_HOST="127.0.0.1"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${LOCAL_DB_BACKEND_DIR:-$ROOT/backend}"
read -r -a SB <<< "${LOCAL_DB_SUPABASE_CMD:-pnpm exec supabase}"

die() { echo "local-db: $*" >&2; exit 1; }

check_config() {
  local cfg="$BACKEND_DIR/supabase/config.toml"
  [ -f "$cfg" ] || die "missing $cfg"
  local project port
  project="$(sed -nE 's/^project_id *= *"([^"]*)".*/\1/p' "$cfg" | head -n1)"
  port="$(awk '/^\[db\]/{f=1;next} /^\[/{f=0} f && /^port *=/{gsub(/[^0-9]/,"",$0); print; exit}' "$cfg")"
  [ "$project" = "$EXPECTED_PROJECT" ] || die "config project_id is '$project', expected '$EXPECTED_PROJECT'"
  [ "$port" = "$EXPECTED_PORT" ] || die "config [db] port is '$port', expected $EXPECTED_PORT"
}

# config.toml enables Google sign-in with credentials read from the environment. Without real
# credentials the CLI still needs values, so pass harmless placeholders (email/password sign-in
# keeps working; the Google button then reports that Google is not set up). Real credentials come
# from the process environment or the git-ignored backend/supabase/.env and are never overridden.
#
# config.toml also enables Cloudflare Turnstile for password sign-in. Locally it defaults to
# Cloudflare's published always-pass TEST secret (a public documentation value, not a secret), so
# the stack works out of the box with the matching test site key. A real secret is read from the
# environment or backend/supabase/.env and is never overridden.
google_env_defaults() {
  local var envfile="$BACKEND_DIR/supabase/.env"
  for var in SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET; do
    if [ -n "${!var:-}" ]; then continue; fi
    if [ -f "$envfile" ] && grep -Eq "^${var}=.+" "$envfile"; then continue; fi
    export "$var=google-not-configured"
  done
  var=SUPABASE_AUTH_CAPTCHA_SECRET
  if [ -z "${!var:-}" ] && ! { [ -f "$envfile" ] && grep -Eq "^${var}=.+" "$envfile"; }; then
    export "$var=1x0000000000000000000000000000000AA"
  fi
}

# Prints the verified database URL (password hidden) or exits non-zero.
verify_target() {
  check_config
  local out url
  out="$(cd "$BACKEND_DIR" && "${SB[@]}" status -o json)" \
    || die "cannot read local Supabase status (is Docker and the stack running?). Not guessing a target."
  url="$(printf '%s' "$out" | grep -o '"DB_URL" *: *"[^"]*"' | head -n1 | sed -E 's/^"DB_URL" *: *"//; s/"$//')"
  [ -n "$url" ] || die "status output has no DB_URL"
  case "$url" in
    postgresql://*@"$EXPECTED_HOST:$EXPECTED_PORT"/*) ;;
    *) die "database target is not $EXPECTED_HOST:$EXPECTED_PORT (refusing to continue)" ;;
  esac
  echo "target: project=$EXPECTED_PROJECT db=$EXPECTED_HOST:$EXPECTED_PORT (local)"
}

confirm_reset() {
  echo "DESTRUCTIVE: this replaces ALL rows in the local database $EXPECTED_HOST:$EXPECTED_PORT (project $EXPECTED_PROJECT)." >&2
  if [ "${1:-}" = "--yes" ]; then return 0; fi
  [ -t 0 ] || die "confirmation required: pass --yes, or run interactively"
  local reply
  read -r -p "Type 'reset $EXPECTED_PORT' to continue: " reply
  [ "$reply" = "reset $EXPECTED_PORT" ] || die "not confirmed; nothing changed"
}

cmd="${1:-}"
[ -n "$cmd" ] || die "usage: local-db.sh {check|status|start|stop|reset [--yes]|test|psql}"
shift

case "$cmd" in
  check)
    verify_target ;;
  status)
    verify_target
    (cd "$BACKEND_DIR" && "${SB[@]}" status -o pretty) ;;
  start)
    check_config
    if (cd "$BACKEND_DIR" && "${SB[@]}" status -o json > /dev/null); then
      verify_target
      echo "already running"
    else
      if [ -z "${LOCAL_DB_SKIP_PORT_CHECK:-}" ] && command -v lsof > /dev/null \
        && lsof -nP -iTCP:"$EXPECTED_PORT" -sTCP:LISTEN > /dev/null; then
        die "port $EXPECTED_PORT is already in use by another process; stop it yourself. Not starting."
      fi
      google_env_defaults
      (cd "$BACKEND_DIR" && "${SB[@]}" start)
      verify_target
    fi ;;
  stop)
    check_config
    (cd "$BACKEND_DIR" && "${SB[@]}" stop) ;;
  reset)
    case "${1:-}" in ""|--yes) ;; *) die "unexpected argument '$1'" ;; esac
    [ "$#" -le 1 ] || die "unexpected arguments"
    verify_target
    confirm_reset "${1:-}"
    (cd "$BACKEND_DIR" && "${SB[@]}" db reset --local) ;;
  test)
    [ "$#" -eq 0 ] || die "unexpected arguments"
    verify_target
    (cd "$BACKEND_DIR" && "${SB[@]}" test db --local) ;;
  psql)
    [ "$#" -eq 0 ] || die "unexpected arguments"
    verify_target
    exec psql "postgresql://postgres:postgres@$EXPECTED_HOST:$EXPECTED_PORT/postgres" ;;
  *)
    die "unknown command '$cmd'" ;;
esac

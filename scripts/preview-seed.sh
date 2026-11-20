#!/usr/bin/env bash
# Seeds and verifies the Preview (staging) Supabase project. Called ONLY by the "staging" job of
# .github/workflows/db-deploy.yml (develop branch, GitHub environment "Database Preview").
#
#   scripts/preview-seed.sh seed     run backend/supabase/seed.sql (the existing synthetic seed) once
#   scripts/preview-seed.sh verify   run the read-only checks and fail on any false row
#
# Safety: refuses unless the project reference is set, differs from the production reference, and equals the
# project this checkout is linked to; the connection address must be THAT project's pooler. The database
# password is read from the environment (SUPABASE_DB_PASSWORD) and handed to psql as PGPASSWORD only: it is
# never in a command line, an address or the report. Results are appended to $GITHUB_STEP_SUMMARY.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${PREVIEW_BACKEND_DIR:-$ROOT/backend}"
PSQL="${PREVIEW_PSQL:-psql}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
MODE="${1:-}"

die() { echo "preview-seed: $*" >&2; exit 1; }
say() { printf '%s\n' "$*" >> "$SUMMARY"; }

case "$MODE" in seed|verify) ;; *) die "usage: preview-seed.sh seed|verify" ;; esac

command -v "$PSQL" > /dev/null || die "psql is not installed"
[ -n "${SUPABASE_PROJECT_REF:-}" ] || die "SUPABASE_PROJECT_REF is not set for this environment"
[ -n "${PRODUCTION_PROJECT_REF:-}" ] || die "PRODUCTION_PROJECT_REF is not set; refusing to continue"
[ "$SUPABASE_PROJECT_REF" != "$PRODUCTION_PROJECT_REF" ] || die "the staging reference equals the production reference; refusing to continue"
[ -n "${SUPABASE_DB_PASSWORD:-}" ] || die "SUPABASE_DB_PASSWORD is not set"

LINKED_FILE="$BACKEND_DIR/supabase/.temp/project-ref"
[ -f "$LINKED_FILE" ] || die "no linked project found (run supabase link first)"
LINKED="$(cat "$LINKED_FILE")"
[ "$LINKED" = "$SUPABASE_PROJECT_REF" ] || die "the linked project is not this environment's staging project; refusing to continue"
[ "$LINKED" != "$PRODUCTION_PROJECT_REF" ] || die "linked to production; refusing to continue"

POOLER_FILE="$BACKEND_DIR/supabase/.temp/pooler-url"
[ -f "$POOLER_FILE" ] || die "no pooler address for the linked project"
URL="$(tr -d '\n\r ' < "$POOLER_FILE")"
case "$URL" in
  "postgresql://postgres.$SUPABASE_PROJECT_REF@"*.pooler.supabase.com:*) ;;
  *) die "the connection address is not this project's pooler; refusing to continue" ;;
esac
case "$URL" in *:*:*@*) die "the connection address must not contain a password" ;; esac

export PGPASSWORD="$SUPABASE_DB_PASSWORD"
export PGSSLMODE="${PGSSLMODE:-require}"

if [ "$MODE" = "seed" ]; then
  say '### Preview: synthetic seed'
  # seed.sql runs in its own transaction and refuses a database with real accounts. A rerun refreshes the
  # time-dependent match state and never duplicates rows.
  if "$PSQL" "$URL" -X -q -v ON_ERROR_STOP=1 -f "$BACKEND_DIR/supabase/seed.sql"; then
    say 'Seed: PASSED'
    say ''
    say '| Table | Rows |'
    say '|---|---|'
    "$PSQL" "$URL" -X -q --csv -v ON_ERROR_STOP=1 -c "
      SELECT 'teams' AS table_name, count(*) AS rows FROM public.teams
      UNION ALL SELECT 'players', count(*) FROM public.players
      UNION ALL SELECT 'matches', count(*) FROM public.matches
      UNION ALL SELECT 'match_events', count(*) FROM public.match_events
      UNION ALL SELECT 'predictions', count(*) FROM public.predictions
      UNION ALL SELECT 'newsletter', count(*) FROM public.newsletter
      UNION ALL SELECT 'wc_matches', count(*) FROM public.wc_matches
      UNION ALL SELECT 'wc_predictions', count(*) FROM public.wc_predictions" \
      | tail -n +2 | while IFS=, read -r name rows; do say "| $name | $rows |"; done
    echo "Seed applied."
  else
    say 'Seed: FAILED (see the step log; nothing was committed from the failing run)'
    die "the seed failed"
  fi
  exit 0
fi

# verify
say '### Preview: verification'
failed=0
total=0
say '| Check | Result |'
say '|---|---|'
for sql in "$ROOT/scripts/sql/verify-preview.sql" "$ROOT/scripts/sql/verify-captain-rpc.sql"; do
  if ! out="$("$PSQL" "$URL" -X -q --csv -v ON_ERROR_STOP=1 -f "$sql")"; then
    say "| $(basename "$sql") | FAIL (could not run) |"
    failed=$((failed + 1))
    continue
  fi
  rows="$(printf '%s\n' "$out" | tail -n +2)"
  if [ -z "$rows" ]; then
    say "| $(basename "$sql") | FAIL (no rows returned) |"
    failed=$((failed + 1))
    continue
  fi
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    name="${line%,*}"
    passed="${line##*,}"
    total=$((total + 1))
    if [ "$passed" = "t" ]; then
      say "| $name | PASS |"
    else
      say "| $name | FAIL |"
      failed=$((failed + 1))
    fi
  done <<< "$rows"
done
say ''
if [ "$failed" -eq 0 ]; then
  say "Verification: PASSED ($total checks)"
  echo "Verification passed ($total checks)."
else
  say "Verification: FAILED ($failed failing)"
  die "verification failed ($failed failing)"
fi

#!/usr/bin/env bash
# Shared restore steps for scripts/backup/database-backup.sh (the restore test on a disposable stack) and
# scripts/backup/restore-drill.sh (the owner's drill into the isolated local clone). Sourced, not run.
#
# The restore is selective, as proven on the production clone (2026-11-19): the public schema with its policies,
# grants and functions, the triggers on auth.users, the migration history, and the data of the public tables, the
# Auth accounts and identities, and the migration history. Supabase-managed schemas come from the target stack itself.

# Exact row counts of every public table plus the Auth accounts and identities, as "schema.table|count" (read-only).
backup_counts() {
  psql "$1" -X -q -A -t -v ON_ERROR_STOP=1 <<'SQL'
BEGIN READ ONLY;
SELECT format('SELECT %L || ''|'' || count(*) FROM %I.%I', n.nspname || '.' || c.relname, n.nspname, c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p') AND (n.nspname = 'public' OR (n.nspname = 'auth' AND c.relname IN ('users', 'identities')))
ORDER BY 1 \gexec
ROLLBACK;
SQL
}

backup_migration_head() {
  psql "$1" -X -q -A -t -c "SELECT CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN 'none'
    ELSE (SELECT count(*) || ' versions, latest ' || COALESCE(max(version), 'none') FROM supabase_migrations.schema_migrations) END" 2>/dev/null \
    || echo 'unreadable'
}

# restore_archive <target url> <archive> <work dir> [extra sql file run inside the data transaction]
restore_archive() {
  local target="$1" archive="$2" work="$3" extra="${4:-}"
  pg_restore --list "$archive" > "$work/restore-toc.txt" || return 1
  # One pass, in the archive's own order (pg_restore -L runs entries in list order).
  grep -E '^[0-9]+; [0-9]+ [0-9]+ ([A-Z][A-Z ]* (public|supabase_migrations) |SCHEMA - supabase_migrations |TRIGGER auth )' "$work/restore-toc.txt" \
    | grep -vE '^[0-9]+; [0-9]+ [0-9]+ (TABLE DATA|DEFAULT ACL) ' > "$work/restore-schema.list"
  grep -E '^[0-9]+; [0-9]+ [0-9]+ TABLE DATA (public [a-z_0-9]+|auth (users|identities)|supabase_migrations [a-z_0-9]+) ' \
    "$work/restore-toc.txt" > "$work/restore-data.list"
  # Newer Supabase images mark columns with an internal "pg_attver" option that older images reject; it carries no
  # schema or data, so the restore leaves those statements out.
  pg_restore --no-owner -L "$work/restore-schema.list" -f "$work/restore-schema.sql" "$archive" || return 1
  grep -vE '^ALTER TABLE ONLY [^ ]+ ALTER COLUMN [^ ]+ SET \(pg_attver=[0-9]+\);$' "$work/restore-schema.sql" \
    | psql "$target" -X -q -1 -v ON_ERROR_STOP=1 > "$work/restore-schema.log" 2>&1 \
    || { grep -iE 'error' "$work/restore-schema.log" | cut -c1-200 | head -3 >&2; return 1; }
  pg_restore --data-only -L "$work/restore-data.list" -f "$work/restore-data.sql" "$archive" || return 1
  chmod 600 "$work/restore-data.sql"
  {
    echo 'BEGIN;'
    echo 'SET LOCAL session_replication_role = replica;'
    cat "$work/restore-data.sql"
    [ -n "$extra" ] && cat "$extra"
    echo 'COMMIT;'
  } | psql "$target" -X -q -v ON_ERROR_STOP=1 > "$work/restore-data.log" 2>&1 \
    || { grep -iE 'error' "$work/restore-data.log" | cut -c1-200 | head -3 >&2; rm -f "$work/restore-data.sql"; return 1; }
  rm -f "$work/restore-data.sql" "$work/restore-schema.sql"
}

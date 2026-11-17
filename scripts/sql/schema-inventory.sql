-- Read-only schema inventory (catalog only; no table rows are read).
--
-- Purpose: compare a database's schema with the one the repository's migrations create. Run the same
-- file on both and compare the results offline:
--   local:       pnpm db:inventory <output.csv>            (checks the target is the local database first)
--   production:  paste into the Supabase SQL Editor of that project and export the result (keep the file
--                OUTSIDE the repository)
--
-- Safety: it runs in a READ ONLY transaction that is always rolled back, so Postgres itself rejects any
-- write. Columns: category, object, detail, definition, md5 (md5 is empty for informational rows).
-- Scope: the public schema, plus the triggers on auth.users; extension-owned objects are skipped.
BEGIN READ ONLY;

SELECT
  category,
  object,
  detail,
  definition,
  CASE
    WHEN category IN ('row_estimate', 'extension_version', 'server') THEN ''
    ELSE md5(category || '|' || object || '|' || detail || '|' || definition)
  END AS md5
FROM (
  -- schemas present (to spot unexpected ones)
  SELECT 'schema'::text AS category, nspname::text AS object, ''::text AS detail, ''::text AS definition
  FROM pg_namespace
  WHERE nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema'

  UNION ALL
  -- extensions (the version is informational and listed separately)
  SELECT 'extension', e.extname::text, 'schema=' || n.nspname::text, ''
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace

  UNION ALL
  SELECT 'extension_version', e.extname::text, '', e.extversion::text FROM pg_extension e

  UNION ALL
  SELECT 'server', 'version', '', current_setting('server_version')

  UNION ALL
  -- does the CLI migration ledger exist?
  SELECT 'migration_ledger', 'supabase_migrations.schema_migrations',
         CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN 'missing' ELSE 'present' END, ''

  UNION ALL
  -- tables: row level security flags and every column
  SELECT 'table', 'public.' || c.relname::text,
         'rls=' || c.relrowsecurity::text || ' force_rls=' || c.relforcerowsecurity::text,
         COALESCE((
           SELECT string_agg(
                    a.attname::text || ' ' || format_type(a.atttypid, a.atttypmod)
                    || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
                    || COALESCE(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
                    || CASE WHEN a.attidentity <> '' THEN ' identity=' || a.attidentity::text ELSE '' END
                    || CASE WHEN a.attgenerated <> '' THEN ' generated' ELSE '' END,
                    E'\n' ORDER BY a.attnum)
           FROM pg_attribute a
           LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
           WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
         ), '')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')

  UNION ALL
  -- constraints (primary key, foreign key, unique, check)
  SELECT 'constraint', 'public.' || c.relname::text || '.' || con.conname::text, con.contype::text,
         pg_get_constraintdef(con.oid, true)
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')

  UNION ALL
  SELECT 'index', schemaname::text || '.' || tablename::text || '.' || indexname::text, '', indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'

  UNION ALL
  -- views (definition and options such as security_invoker)
  SELECT 'view', 'public.' || c.relname::text, COALESCE(array_to_string(c.reloptions, ','), ''),
         pg_get_viewdef(c.oid, true)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')

  UNION ALL
  -- functions: full definition, SECURITY DEFINER flag, language and settings such as search_path
  SELECT 'function', 'public.' || p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         'secdef=' || p.prosecdef::text || ' lang=' || l.lanname::text || ' volatility=' || p.provolatile::text
           || ' config=' || COALESCE(array_to_string(p.proconfig, ';'), ''),
         pg_get_functiondef(p.oid)
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')

  UNION ALL
  -- triggers on public tables and on auth.users
  SELECT 'trigger', n.nspname::text || '.' || c.relname::text || '.' || t.tgname::text,
         CASE WHEN t.tgenabled = 'O' THEN 'enabled' ELSE 'enabled=' || t.tgenabled::text END,
         pg_get_triggerdef(t.oid, true)
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal AND (n.nspname = 'public' OR (n.nspname = 'auth' AND c.relname = 'users'))

  UNION ALL
  -- row level security policies
  SELECT 'policy', schemaname::text || '.' || tablename::text || '.' || policyname::text,
         cmd::text || ' permissive=' || permissive::text || ' roles=' || array_to_string(roles, ','),
         'USING ' || COALESCE(qual, '-') || ' CHECK ' || COALESCE(with_check, '-')
  FROM pg_policies
  WHERE schemaname = 'public'

  UNION ALL
  -- table, view and sequence privileges for the API roles and PUBLIC
  SELECT 'table_grant', 'public.' || c.relname::text || ' -> ' || COALESCE(r.rolname::text, 'PUBLIC'), '',
         string_agg(x.privilege_type, ',' ORDER BY x.privilege_type)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(c.relacl) x
  LEFT JOIN pg_roles r ON r.oid = x.grantee
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
    AND (r.rolname IN ('anon', 'authenticated', 'service_role') OR x.grantee = 0)
  GROUP BY c.relname, r.rolname, x.grantee

  UNION ALL
  -- function privileges for the API roles and PUBLIC
  SELECT 'function_grant', 'public.' || p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ') -> '
           || COALESCE(r.rolname::text, 'PUBLIC'), '',
         string_agg(x.privilege_type, ',' ORDER BY x.privilege_type)
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(p.proacl) x
  LEFT JOIN pg_roles r ON r.oid = x.grantee
  WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
    AND (r.rolname IN ('anon', 'authenticated', 'service_role') OR x.grantee = 0)
  GROUP BY p.oid, p.proname, r.rolname, x.grantee

  UNION ALL
  SELECT 'default_acl', COALESCE(n.nspname::text, '*') || ' ' || d.defaclobjtype::text || ' for ' || pg_get_userbyid(d.defaclrole)::text,
         '', d.defaclacl::text
  FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace

  UNION ALL
  -- enum types
  SELECT 'type', 'public.' || t.typname::text, t.typtype::text,
         COALESCE((SELECT string_agg(e.enumlabel::text, ',' ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = t.oid), '')
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typtype = 'e'

  UNION ALL
  SELECT 'sequence', 'public.' || c.relname::text, '', ''
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'S'

  UNION ALL
  -- tables published to Realtime and other publications
  SELECT 'publication', pubname::text || ' -> ' || schemaname::text || '.' || tablename::text, '', ''
  FROM pg_publication_tables
  WHERE schemaname = 'public'

  UNION ALL
  -- approximate row counts (informational only; no row data)
  SELECT 'row_estimate', 'public.' || c.relname::text, '', GREATEST(c.reltuples, 0)::bigint::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
) AS inventory
ORDER BY category, object;

ROLLBACK;

// Group: tooling. The read-only schema inventory (scripts/sql/schema-inventory.sql) is used to compare a hosted
// database with the migrations. It must be unable to write, and on the LOCAL database (127.0.0.1:54322 only) it
// must report what the migrations create.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const file = join(__dirname, '../../../scripts/sql/schema-inventory.sql');
const sql = readFileSync(file, 'utf8');
const code = sql
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');

function runInventory() {
  const r = spawnSync('psql', [LOCAL_DB, '-q', '--csv', '-v', 'ON_ERROR_STOP=1', '-f', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r;
}

// minimal CSV parser (quoted fields, doubled quotes, embedded newlines)
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

describe('schema inventory file', () => {
  it('runs inside a read-only transaction that is always rolled back', () => {
    expect(code.trim().startsWith('BEGIN READ ONLY;')).toBe(true);
    expect(code.trim().endsWith('ROLLBACK;')).toBe(true);
  });

  it('contains no statement that could write or change anything', () => {
    for (const word of ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE', 'GRANT', 'REVOKE', 'COPY', 'VACUUM', 'REINDEX', 'COMMENT', 'SET ']) {
      expect(code, word).not.toMatch(new RegExp(`\\b${word.trim()}\\b`, 'i'));
    }
  });

  it('never selects table data, only the catalog', () => {
    expect(code).not.toMatch(/FROM\s+(public|auth)\.\w+/i);
    expect(code).not.toMatch(/FROM\s+auth\./i);
  });
});

describe('schema inventory on the local database', () => {
  const r = runInventory();
  const rows = r.status === 0 ? parseCsv(r.stdout).filter((x) => x.length > 1) : [];
  const header = rows[0] ?? [];
  const data = rows.slice(1).map((x) => Object.fromEntries(header.map((h, i) => [h, x[i]])));
  const by = (cat: string) => data.filter((d) => d.category === cat);

  it('runs without error and has the expected columns', () => {
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(header).toEqual(['category', 'object', 'detail', 'definition', 'md5']);
  });

  it('reports what the migrations create in the public schema', () => {
    expect(by('table')).toHaveLength(26);
    expect(by('view')).toHaveLength(3);
    expect(by('function')).toHaveLength(19);
    expect(by('policy')).toHaveLength(55);
    // the division and season model (20261119000000_divisions_and_seasons.sql)
    for (const t of ['divisions', 'seasons', 'section_types', 'season_sections', 'team_entries', 'legacy_division_map']) {
      expect(by('table').map((r) => r.object), t).toContain(`public.${t}`);
    }
  });

  it('includes row level security flags, constraints and indexes', () => {
    expect(by('table').every((t) => /rls=(true|false)/.test(t.detail))).toBe(true);
    expect(by('table').filter((t) => t.detail.includes('rls=true'))).toHaveLength(26);
    expect(by('constraint').length).toBeGreaterThan(40);
    expect(by('index').length).toBeGreaterThan(15);
  });

  it('includes every trigger, including the four on auth.users from the auth migration', () => {
    const triggers = by('trigger').map((t) => t.object);
    for (const name of ['ensure_domain_lock', 'ensure_domain_lock_on_email_change', 'on_auth_user_created', 'on_auth_user_role_created']) {
      expect(triggers, name).toContain(`auth.users.${name}`);
    }
    expect(triggers.filter((t) => t.startsWith('public.'))).toHaveLength(9);
  });

  it('includes function bodies and security-definer settings used to judge drift', () => {
    const fn = by('function').find((f) => f.object.startsWith('public.enforce_college_domain'));
    expect(fn?.detail).toMatch(/secdef=true/);
    expect(fn?.definition).toMatch(/iiitkottayam/);
  });

  it('records whether the migration ledger exists (production does not have one)', () => {
    expect(by('migration_ledger')).toHaveLength(1);
    expect(by('migration_ledger')[0].detail).toMatch(/^(present|missing)$/);
  });

  it('is deterministic and compares by md5', () => {
    const again = runInventory();
    expect(again.stdout).toBe(r.stdout);
    for (const d of data.filter((x) => ['table', 'function', 'policy'].includes(x.category))) expect(d.md5).toMatch(/^[0-9a-f]{32}$/);
  });

  it('never reports row contents (only approximate counts)', () => {
    expect(by('row_estimate').every((d) => /^\d+$/.test(d.definition))).toBe(true);
    expect(r.stdout).not.toMatch(/@iiitkottayam\.ac\.in/); // no user emails: those are data, not schema
  });

  it('changes nothing in the database', () => {
    const count = () =>
      spawnSync('psql', [LOCAL_DB, '-Atc', 'select (select count(*) from auth.users)||\',\'||(select count(*) from pg_trigger)||\',\'||(select count(*) from pg_proc)'], { encoding: 'utf8' }).stdout.trim();
    const before = count();
    runInventory();
    expect(count()).toBe(before);
  });
});

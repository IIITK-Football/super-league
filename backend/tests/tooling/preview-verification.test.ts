// Group: tooling. scripts/sql/verify-preview.sql is the read-only check the deploy workflow runs against the
// Preview (staging) project after seeding. It must change nothing, use minimum counts only (so testers' data
// never fails it), and pass on a freshly seeded database.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sqlFile = join(__dirname, '../../../scripts/sql/verify-preview.sql');
const sql = readFileSync(sqlFile, 'utf8');
const code = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

describe('verify-preview.sql', () => {
  it('is one read-only SELECT: no writes, no DDL, no transaction control', () => {
    expect(code.trim().toUpperCase().startsWith('SELECT')).toBe(true);
    expect(code.trim().endsWith(';')).toBe(true);
    expect(code.trim().slice(0, -1)).not.toContain(';'); // a single statement
    for (const w of ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE', 'GRANT', 'REVOKE', 'BEGIN', 'COMMIT']) {
      expect(code, w).not.toMatch(new RegExp(`\\b${w}\\b`, 'i'));
    }
  });

  it('uses minimum counts, never exact ones, so tester data cannot fail it', () => {
    expect(code).not.toMatch(/count\(\*\)\s*=\s*\d{2,}/); // no exact large counts (a two-captain check is fine)
    expect(code).toMatch(/>=\s*168/);
  });

  it('reads no account details (no emails or passwords)', () => {
    expect(code).not.toMatch(/\bemail\b|encrypted_password|raw_user_meta_data/i);
  });

  it('passes every check on the seeded local database, in a read-only session', () => {
    const r = spawnSync('psql', [LOCAL_DB, '-X', '-q', '--csv', '-v', 'ON_ERROR_STOP=1', '-f', sqlFile], {
      encoding: 'utf8',
      env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on' },
    });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split('\n');
    expect(lines[0]).toBe('check_name,passed');
    const rows = lines.slice(1).map((l) => l.split(','));
    expect(rows.length).toBeGreaterThanOrEqual(15);
    expect(rows.filter((x) => x[1] !== 't').map((x) => x[0])).toEqual([]);
  });
});

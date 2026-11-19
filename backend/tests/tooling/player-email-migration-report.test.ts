// Group: tooling. scripts/sql/player-email-migration-report.sql is a read-only report: it writes nothing by
// construction (a READ ONLY transaction, rolled back, with no write statements) and runs on the LOCAL database
// (127.0.0.1:54322 only), listing the conversion outcomes (counts, no address) and the matching cases of the seed.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const file = join(__dirname, '../../../scripts/sql/player-email-migration-report.sql');
const psql = (sql: string) => spawnSync('psql', [LOCAL_DB, '-X', '-q', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });

describe('player-email-migration-report.sql', () => {
  it('is read-only by construction', () => {
    const code = readFileSync(file, 'utf8').replace(/--.*$/gm, '');
    expect(code).toMatch(/BEGIN READ ONLY;/);
    expect(code.trim()).toMatch(/ROLLBACK;$/);
    for (const word of ['INSERT', 'UPDATE', 'DELETE', 'ALTER', 'DROP', 'CREATE', 'GRANT', 'TRUNCATE', 'COMMIT']) {
      expect(code, word).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'));
    }
  });

  it('reports every matching case of the seed and changes nothing', () => {
    const before = psql('SELECT count(*) FROM public.players WHERE user_id IS NOT NULL').stdout;
    const r = spawnSync('psql', [LOCAL_DB, '-X', '-q', '--csv', '-v', 'ON_ERROR_STOP=1', '-f', file], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^outcome,players$/m);
    for (const status of ['ready', 'duplicate', 'waiting_verification', 'conflict', 'no_account']) expect(r.stdout).toMatch(new RegExp(`^${status},`, 'm'));
    expect(psql('SELECT count(*) FROM public.players WHERE user_id IS NOT NULL').stdout).toBe(before);
  });
});

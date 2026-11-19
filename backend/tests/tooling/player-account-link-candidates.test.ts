// Group: tooling. scripts/sql/player-account-link-candidates.sql is a read-only review: it writes nothing by
// construction (a READ ONLY transaction, rolled back, with no write statements) and runs on the LOCAL database
// (127.0.0.1:54322 only), listing candidate links and shared contact emails without linking anything.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const file = join(__dirname, '../../../scripts/sql/player-account-link-candidates.sql');
const psql = (sql: string) => spawnSync('psql', [LOCAL_DB, '-X', '-q', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });

describe('player-account-link-candidates.sql', () => {
  it('is read-only by construction', () => {
    const code = readFileSync(file, 'utf8').replace(/--.*$/gm, '');
    expect(code).toMatch(/BEGIN READ ONLY;/);
    expect(code.trim()).toMatch(/ROLLBACK;$/);
    for (const word of ['INSERT', 'UPDATE', 'DELETE', 'ALTER', 'DROP', 'CREATE', 'GRANT', 'TRUNCATE', 'COMMIT']) {
      expect(code, word).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'));
    }
  });

  it('runs on the local database and links nothing', () => {
    const before = psql('SELECT count(*) FROM public.players WHERE user_id IS NOT NULL').stdout;
    const r = spawnSync('psql', [LOCAL_DB, '-X', '-q', '--csv', '-v', 'ON_ERROR_STOP=1', '-f', file], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^player_id,email,player,status$/m);
    expect(r.stdout).toMatch(/^email,players,names$/m);
    expect(psql('SELECT count(*) FROM public.players WHERE user_id IS NOT NULL').stdout).toBe(before);
  });
});

// Group: tooling. Tools that confirm the captain roster function is closed to anonymous callers on a given project,
// and that the retired member-table function (both overloads) is closed or gone.
//  - scripts/verify-rpc-closed.mjs: calls each function with the PUBLIC (publishable) key and a random id, so it
//    cannot change any data even if a function were open.
//  - scripts/sql/verify-captain-rpc.sql: read-only catalog checks, PASS/FAIL per row.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
// @ts-ignore plain ESM script
import { classify, probeAll } from '../../../scripts/verify-rpc-closed.mjs';
import { localKeys } from '../auth/local-supabase';

const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sqlFile = join(__dirname, '../../../scripts/sql/verify-captain-rpc.sql');

const res = (status: number, body: unknown) => ({ status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

describe('classify', () => {
  it('treats a permission-denied answer as closed', () => {
    expect(classify(401, { code: '42501', message: 'permission denied for function captain_update_team_member' })).toBe('closed');
    expect(classify(403, { code: '42501' })).toBe('closed');
  });

  it('treats a successful or in-function answer as OPEN (the function ran)', () => {
    expect(classify(204, '')).toBe('open');
    expect(classify(200, 'null')).toBe('open');
    expect(classify(400, { code: 'P0001', message: 'Choose a valid player position' })).toBe('open');
    expect(classify(400, { code: 'P0001', message: 'You must be signed in' })).toBe('open');
  });

  it('is inconclusive when the function cannot be found or the project is unreachable', () => {
    expect(classify(404, { code: 'PGRST202' })).toBe('inconclusive');
    expect(classify(0, '')).toBe('inconclusive');
    expect(classify(500, { code: 'XX000' })).toBe('inconclusive');
  });
});

describe('probeAll', () => {
  it('probes the roster function and both retired overloads with random ids, sending the key only as apikey', async () => {
    const calls: { url: string; init: any }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: any) => {
      calls.push({ url, init });
      return res(401, { code: '42501', message: 'permission denied' });
    });
    const out = await probeAll('https://project.example.test', 'publishable-placeholder', fetchImpl as any);
    expect(out.map((o: any) => o.verdict)).toEqual(['closed', 'closed', 'closed']);
    expect(calls.map((c) => c.url)).toEqual([
      'https://project.example.test/rest/v1/rpc/captain_update_roster_player',
      'https://project.example.test/rest/v1/rpc/captain_update_team_member',
      'https://project.example.test/rest/v1/rpc/captain_update_team_member',
    ]);
    expect(JSON.parse(calls[0].init.body).p_membership_id).toMatch(/^[0-9a-f-]{36}$/); // a random id that matches nothing
    expect(JSON.parse(calls[1].init.body).p_member_id).toMatch(/^[0-9a-f-]{36}$/);
    for (const c of calls) {
      expect(c.init.headers.apikey).toBe('publishable-placeholder');
      expect(Object.keys(c.init.headers).map((h) => h.toLowerCase())).not.toContain('authorization');
    }
    expect(JSON.stringify(out)).not.toContain('publishable-placeholder');
  });

  it('flags an open function', async () => {
    const out = await probeAll('https://p.example.test', 'k', (async () => res(204, '')) as any);
    expect(out.some((o: any) => o.verdict === 'open')).toBe(true);
  });

  it('counts a retired overload that no longer exists as retired, but a missing roster function as inconclusive', async () => {
    const out = await probeAll('https://p.example.test', 'k', (async () => res(404, { code: 'PGRST202' })) as any);
    expect(out.map((o: any) => o.verdict)).toEqual(['inconclusive', 'retired', 'retired']);
  });
});

describe('against the local stack (this project, 127.0.0.1:54321)', () => {
  it('reports the roster function closed and the retired overloads gone', async () => {
    const keys = localKeys();
    const out = await probeAll(keys.url, keys.publishable);
    expect(out.map((o: any) => `${o.overload}:${o.verdict}`)).toEqual(['roster player:closed', '7-argument (retired):retired', '5-argument (retired):retired']);
  }, 20000); // three sequential requests to the local API; the default 5 s is tight under a full-suite run

  it('the command prints one verdict per function, never prints the key, and refuses to run without arguments', () => {
    const keys = localKeys();
    const r = spawnSync('node', [join(__dirname, '../../../scripts/verify-rpc-closed.mjs'), keys.url, keys.publishable], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/roster player.*CLOSED/);
    expect(r.stdout).toMatch(/RESULT: CLOSED/);
    expect(r.stdout + r.stderr).not.toContain(keys.publishable);
    expect(spawnSync('node', [join(__dirname, '../../../scripts/verify-rpc-closed.mjs')], { encoding: 'utf8' }).status).not.toBe(0);
  });
});

describe('verify-captain-rpc.sql', () => {
  const sql = readFileSync(sqlFile, 'utf8');
  const code = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

  it('is read-only by construction', () => {
    expect(code.trim().startsWith('BEGIN READ ONLY;')).toBe(true);
    expect(code.trim().endsWith('ROLLBACK;')).toBe(true);
    for (const w of ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE', 'GRANT', 'REVOKE']) {
      expect(code, w).not.toMatch(new RegExp(`\\b${w}\\b`, 'i'));
    }
  });

  it('passes every check on the local database', () => {
    const r = spawnSync('psql', [LOCAL_DB, '-q', '--csv', '-v', 'ON_ERROR_STOP=1', '-f', sqlFile], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split('\n');
    expect(lines[0]).toBe('check_name,passed');
    const rows = lines.slice(1).map((l) => l.split(','));
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(rows.filter((x) => x[1] !== 't').map((x) => x[0])).toEqual([]);
  });
});

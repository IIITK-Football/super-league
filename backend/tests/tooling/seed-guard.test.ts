// Group: tooling. The synthetic seed must refuse to run on a database that holds real accounts.
// The guard block is cut out of seed.sql (between its marker comments) and run in a transaction
// that is ALWAYS rolled back, on the LOCAL database (127.0.0.1:54322) only.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const seed = readFileSync(join(__dirname, '../../supabase/seed.sql'), 'utf8');

function guardBlock(): string {
  const start = seed.indexOf('-- seed-guard:start');
  const end = seed.indexOf('-- seed-guard:end');
  if (start < 0 || end < 0) return '';
  return seed.slice(start, end);
}

function run(setupSql: string) {
  const script = `BEGIN;\n${setupSql}\n${guardBlock()}\nROLLBACK;\n`;
  return spawnSync('psql', [LOCAL_DB, '-v', 'ON_ERROR_STOP=1', '-q'], { input: script, encoding: 'utf8' });
}

const addUsers = (prefix: string, n: number, start = 1) => `
  INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
  SELECT gen_random_uuid(), 'authenticated', 'authenticated', '${prefix}' || lpad(i::text, 2, '0') || '@iiitkottayam.ac.in', '', now(), now()
  FROM generate_series(${start}, ${start + n - 1}) AS i;`;

describe('seed guard', () => {
  it('is the first thing the seed does, inside its transaction', () => {
    expect(seed.startsWith('BEGIN;')).toBe(true);
    expect(seed.indexOf('-- seed-guard:start')).toBeGreaterThan(-1);
    expect(seed.indexOf('-- seed-guard:start')).toBeLessThan(seed.indexOf('INSERT INTO'));
    expect(seed.indexOf('-- seed-guard:end')).toBeLessThan(seed.indexOf('INSERT INTO'));
  });

  it('lets the seed run on an empty or small development database', () => {
    const r = run('');
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('allows a handful of non-fixture test accounts, with elevated roles (a staging project)', () => {
    const r = run(`${addUsers('guardtest', 15)}
      UPDATE public.user_roles SET role = 'dictator' WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'guardtest01@%');`);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('refuses when many non-fixture accounts exist (real data)', () => {
    const r = run(addUsers('guardreal', 25));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Refusing to seed/);
  });

  it('does not count the seed\'s own fixture accounts, however many there are', () => {
    // fan50..fan89 follow the fixture address pattern and do not exist yet in the seed
    const r = run(addUsers('fan', 40, 50));
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('leaves the database unchanged', () => {
    const r = spawnSync('psql', [LOCAL_DB, '-Atc', "select count(*) from auth.users where email like 'guard%'"], { encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('0');
  });
});

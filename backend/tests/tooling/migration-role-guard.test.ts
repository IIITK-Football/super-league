// Group: tooling. Migration 20261118000000 refuses to run (changing nothing) while any assigned team captain lacks
// the captain role, so a real captain is never locked out. The guard block is cut out of the migration (between its
// marker comments) and run in a transaction that is ALWAYS rolled back, on the LOCAL database (127.0.0.1:54322) only.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const migration = readFileSync(join(__dirname, '../../supabase/migrations/20261118000000_restrict_captain_update_team_member.sql'), 'utf8');

function guardBlock(): string {
  const start = migration.indexOf('-- captain-role-guard:start');
  const end = migration.indexOf('-- captain-role-guard:end');
  return start < 0 || end < 0 ? '' : migration.slice(start, end);
}

const USER = 'b0000000-0000-4000-8000-0000000000aa';
function run(setup: string) {
  const script = `BEGIN;
    INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
      VALUES ('${USER}', 'authenticated', 'authenticated', 'guard.captain@iiitkottayam.ac.in', '', now(), now());
    INSERT INTO public.team_registrations (id, captain_id, team_name, season_id)
      SELECT 'b1000000-0000-4000-8000-0000000000aa', '${USER}', 'Guard Team', s.id
      FROM public.seasons s JOIN public.divisions d ON d.id = s.division_id WHERE d.slug = 'freshers' AND s.is_current;
    ${setup}
    ${guardBlock()}
    ROLLBACK;`;
  return spawnSync('psql', [LOCAL_DB, '-v', 'ON_ERROR_STOP=1', '-q'], { input: script, encoding: 'utf8' });
}

describe('captain role guard in the migration', () => {
  it('exists, runs before the function is replaced, and reports only a count', () => {
    expect(guardBlock()).not.toBe('');
    expect(migration.indexOf('-- captain-role-guard:end')).toBeLessThan(migration.indexOf('CREATE OR REPLACE FUNCTION'));
    expect(guardBlock()).toMatch(/count\(\*\)/);
    expect(guardBlock()).toMatch(/scripts\/sql\/captain-role-audit\.sql/);
  });

  it('stops when an assigned captain only has the default role, without naming anyone', () => {
    const r = run(`UPDATE public.user_roles SET role = 'default' WHERE user_id = '${USER}';`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/assigned captain without the captain role/);
    expect(r.stderr).toMatch(/Nothing was changed/);
    expect(r.stderr).not.toMatch(/guard\.captain@|iiitkottayam/);
  });

  // (A legacy admin can no longer be stored: 20261130000000 retired that role value.)
  it('stops for an editor and a missing role row (no role implies another)', () => {
    for (const setup of [
      `UPDATE public.user_roles SET role = 'editor' WHERE user_id = '${USER}';`,
      `DELETE FROM public.user_roles WHERE user_id = '${USER}';`,
    ]) {
      const r = run(setup);
      expect(r.status, setup).not.toBe(0);
      expect(r.stderr, setup).toMatch(/assigned captain without the captain role/);
    }
  });

  it('passes when every assigned captain holds the captain role, or is a dictator', () => {
    for (const role of ['captain', 'dictator']) {
      const r = run(`UPDATE public.user_roles SET role = '${role}' WHERE user_id = '${USER}';`);
      expect(r.stderr, role).toBe('');
      expect(r.status, role).toBe(0);
    }
  });

  it('leaves the database unchanged (the test always rolls back)', () => {
    const r = spawnSync('psql', [LOCAL_DB, '-Atc', `select (select count(*) from auth.users where id = '${USER}') || ',' || (select count(*) from public.team_registrations where team_name = 'Guard Team')`], { encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('0,0');
  });
});

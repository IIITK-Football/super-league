// Group: tooling. Migration 20261201000000 stops, changing nothing, when a team registration has no team entry or two
// registrations would give one team entry two captains, so no captain is lost or doubled. The guard block is cut out
// of the migration (between its marker comments) and run in a transaction that is ALWAYS rolled back, on the LOCAL
// database (127.0.0.1:54322) only.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const migration = readFileSync(join(__dirname, '../../supabase/migrations/20261201000000_roles_and_assignments.sql'), 'utf8');

function guardBlock(): string {
  const start = migration.indexOf('-- role-migration-guard:start');
  const end = migration.indexOf('-- role-migration-guard:end');
  return start < 0 || end < 0 ? '' : migration.slice(start, end);
}

// Two accounts and a Freshers-season team to register them on. team_registrations is retired by the next migration, so the old table is recreated inside the rolled-back transaction.
const A = 'b2000000-0000-4000-8000-0000000000a1';
const B = 'b2000000-0000-4000-8000-0000000000a2';
const run = (setup: string) =>
  spawnSync('psql', [LOCAL_DB, '-v', 'ON_ERROR_STOP=1', '-q'], {
    encoding: 'utf8',
    input: `BEGIN;
      -- team_registrations is retired (20261201000001); the guard predates that, so the table is recreated inside this
      -- always-rolled-back transaction to run the guard exactly as it ran when the migration applied.
      CREATE TABLE public.team_registrations (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, captain_id uuid NOT NULL, team_name text, season_id uuid, team_id uuid, created_at timestamptz DEFAULT now());
      INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at) VALUES
        ('${A}', 'authenticated', 'authenticated', 'guard.a@iiitkottayam.ac.in', '', now(), now()),
        ('${B}', 'authenticated', 'authenticated', 'guard.b@iiitkottayam.ac.in', '', now(), now());
      CREATE TEMP TABLE _s AS SELECT s.id AS season_id FROM public.seasons s JOIN public.divisions d ON d.id = s.division_id WHERE d.slug = 'freshers' AND s.is_current;
      INSERT INTO public.teams (id, name) VALUES ('b2100000-0000-4000-8000-0000000000a1', 'Guard Team');
      ${setup}
      ${guardBlock()}
      ROLLBACK;`,
  });

describe('role migration guard', () => {
  it('exists, runs before any change, and reports only counts', () => {
    expect(guardBlock()).not.toBe('');
    expect(migration.indexOf('-- role-migration-guard:end')).toBeLessThan(migration.indexOf('CREATE TEMP TABLE _role_counts'));
    expect(guardBlock()).toMatch(/count\(\*\)/);
    expect(guardBlock()).not.toMatch(/email/i);
  });

  it('stops for a registration whose team is not entered in its season, without naming anyone', () => {
    const r = run(`INSERT INTO public.team_registrations (captain_id, team_name, season_id, team_id) SELECT '${A}', 'Guard Team', season_id, 'b2100000-0000-4000-8000-0000000000a1' FROM _s;`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/have no team entry/);
    expect(r.stderr).toMatch(/nothing was changed/);
    expect(r.stderr).not.toMatch(/guard\.a@|iiitkottayam/);
  });

  it('stops for a registration with no team at all', () => {
    const r = run(`INSERT INTO public.team_registrations (captain_id, team_name, season_id) SELECT '${A}', 'Guard Team', season_id FROM _s;`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/have no team entry/);
  });

  it('stops when two registrations would give one team entry two captains', () => {
    const r = run(`INSERT INTO public.team_entries (team_id, season_id) SELECT 'b2100000-0000-4000-8000-0000000000a1', season_id FROM _s;
      INSERT INTO public.team_registrations (captain_id, team_name, season_id, team_id) SELECT '${A}', 'Guard Team', season_id, 'b2100000-0000-4000-8000-0000000000a1' FROM _s;
      INSERT INTO public.team_registrations (captain_id, team_name, season_id, team_id) SELECT '${B}', 'Guard Team', season_id, 'b2100000-0000-4000-8000-0000000000a1' FROM _s;`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/more than one registration/);
  });

  it('passes for a registration with a matching team entry, and leaves the database unchanged', () => {
    const ok = run(`INSERT INTO public.team_entries (team_id, season_id) SELECT 'b2100000-0000-4000-8000-0000000000a1', season_id FROM _s;
      INSERT INTO public.team_registrations (captain_id, team_name, season_id, team_id) SELECT '${A}', 'Guard Team', season_id, 'b2100000-0000-4000-8000-0000000000a1' FROM _s;`);
    expect(ok.stderr).toBe('');
    expect(ok.status).toBe(0);
    const left = spawnSync('psql', [LOCAL_DB, '-Atc', `select (select count(*) from auth.users where id in ('${A}','${B}')) || ',' || (select count(*) from public.teams where name = 'Guard Team') || ',' || (select count(*) from pg_class where relname = 'team_registrations')`], { encoding: 'utf8' });
    expect(left.stdout.trim()).toBe('0,0,0');
  });
});

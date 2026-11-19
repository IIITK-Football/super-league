#!/usr/bin/env node
// Rehearses the roster migrations (player identity and season rosters) on the LOCAL database only:
//   1. reset the local project to the last migration before them, without the seed (scripts/local-db.sh, which
//      verifies the target is this project's database on 127.0.0.1:54322 and requires --yes);
//   2. load the seed as it was before them (from Git) and a legacy edge-case fixture;
//   3. apply each newer migration in its own transaction with psql, as the deploy would;
//   4. check the result with backend/supabase/rehearsal/rosters.test.sql;
//   5. repeat with an ambiguous fixture and expect the migration to stop with nothing changed;
//   6. reset the local database normally (all migrations and the current seed).
// Destructive for local data, so it is an explicit command and never part of a routine test group.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = join(ROOT, 'backend');
const MIGRATIONS = join(BACKEND, 'supabase/migrations');
const REHEARSAL = join(BACKEND, 'supabase/rehearsal');
// The last migration and the last commit before the roster work.
export const LEGACY_VERSION = '20261123000000';
export const LEGACY_REF = 'ae183ff2928e60639e45f03ebd45cde01d3e749d';
const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export function newerMigrations(files, version = LEGACY_VERSION) {
  return files.filter((f) => /^\d{14}_.+\.sql$/.test(f) && f.slice(0, 14) > version).sort();
}

function run(cmd, args, { input, cwd = ROOT, quiet = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, input, encoding: 'utf8', stdio: [input === undefined ? 'inherit' : 'pipe', 'pipe', 'pipe'] });
  if (!quiet) {
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
  }
  return r;
}

function must(r, what) {
  if (r.status !== 0) throw new Error(`${what} failed (exit ${r.status}).`);
  return r;
}

const psql = (args, opts) => run('psql', [DB_URL, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args], opts);

function prepare(fixture) {
  must(run('bash', ['scripts/local-db.sh', 'reset', '--yes', '--version', LEGACY_VERSION, '--no-seed']), 'reset to the legacy schema');
  const seed = must(run('git', ['show', `${LEGACY_REF}:backend/supabase/seed.sql`], { quiet: true }), 'reading the legacy seed').stdout;
  must(psql(['-1'], { input: seed, quiet: true }), 'loading the legacy seed');
  must(psql(['-1', '-f', join(REHEARSAL, fixture)]), `loading ${fixture}`);
}

function applyNewer() {
  for (const file of newerMigrations(readdirSync(MIGRATIONS))) {
    const r = psql(['-1', '-f', join(MIGRATIONS, file)], { quiet: true });
    if (r.status !== 0) return { file, error: r.stderr };
    console.log(`applied ${file}`);
  }
  return null;
}

export function main(argv) {
  if (!argv.includes('--yes')) {
    console.error('This rebuilds the local database (127.0.0.1:54322) twice and then resets it. Pass --yes to continue.');
    return 2;
  }
  let failed = false;
  try {
    console.log('\n== Rehearsal 1: legacy data with linked, created and referenced members');
    prepare('legacy_rosters_fixture.sql');
    // The production dry run must work on the legacy schema and predict what the migration then does.
    const dry = must(psql(['-f', join(ROOT, 'scripts/sql/roster-mapping-dryrun.sql')], { quiet: true }), 'the dry-run report').stdout;
    const linked = (dry.match(/\|\s*linked\s*\|/g) ?? []).length;
    const created = (dry.match(/\|\s*created\s*\|/g) ?? []).length;
    if (linked !== 16 || created !== 1 || /AMBIGUOUS/.test(dry)) throw new Error(`the dry run predicted ${linked} linked and ${created} created members`);
    console.log(`dry run predicted ${linked} linked and ${created} created members, no blockers`);
    const err = applyNewer();
    if (err) throw new Error(`migration ${err.file} failed:\n${err.error}`);
    const t = run('pnpm', ['exec', 'supabase', 'test', 'db', '--local', 'supabase/rehearsal/rosters.test.sql'], { cwd: BACKEND });
    if (t.status !== 0 || /Result: FAIL|not ok/.test(t.stdout)) throw new Error('the rehearsal assertions failed');

    console.log('\n== Rehearsal 2: an ambiguous Freshers member must stop the migration');
    prepare('legacy_rosters_ambiguous.sql');
    const stop = applyNewer();
    if (!stop || !/match more than one player on their team/.test(stop.error) || !/Carmen Berzatto/i.test(stop.error)) {
      throw new Error(`expected the roster migration to stop on the ambiguous member, got: ${stop ? stop.error : 'no error'}`);
    }
    const left = must(psql(['-At', '-c', "SELECT to_regclass('public.roster_memberships') IS NULL AND (SELECT count(*) FROM public.team_members) = 16"], { quiet: true }), 'checking the stopped migration');
    if (left.stdout.trim() !== 't') throw new Error('the stopped migration left changes behind');
    console.log(`stopped as expected in ${stop.file}, nothing changed:\n${stop.error.split('\n').find((l) => /ERROR/.test(l))}`);
    console.log('\nRehearsal passed.');
  } catch (e) {
    failed = true;
    console.error(`\nRehearsal FAILED: ${e.message}`);
  } finally {
    console.log('\n== Restoring the local database (all migrations and the current seed)');
    if (run('bash', ['scripts/local-db.sh', 'reset', '--yes']).status !== 0) failed = true;
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));

#!/usr/bin/env node
// Rehearses the match-event migrations on the LOCAL database only (scripts/local-db.sh verifies 127.0.0.1:54322):
//   1. reset to the last migration before them, without the seed; load the seed as it was before them (from Git) and a
//      legacy edge-case fixture (assist = scorer, own goal with assist, non-numeric minute, a score with no goal rows);
//   2. apply each newer migration in its own transaction with psql, as the deploy would;
//   3. check with backend/supabase/rehearsal/match_events.check.sql (scores, events, points, findings; counts only);
//   4. repeat with a blocker (more goal rows than the score) and expect the migration to stop with nothing changed;
//   5. reset the local database normally.
// Destructive for local data, so it is an explicit command and never part of a routine test group.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'backend/supabase/migrations');
const REHEARSAL = join(ROOT, 'backend/supabase/rehearsal');
// The last migration and the last commit before the match-event work.
export const LEGACY_VERSION = '20261201000001';
export const LEGACY_REF = '7def8a4';
const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export function newerMigrations(files, version = LEGACY_VERSION) {
  return files.filter((f) => /^\d{14}_.+\.sql$/.test(f) && f.slice(0, 14) > version).sort();
}

function run(cmd, args, { input, quiet = false } = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, input, encoding: 'utf8', stdio: [input === undefined ? 'inherit' : 'pipe', 'pipe', 'pipe'] });
  if (!quiet) { if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr); }
  return r;
}
const must = (r, what) => { if (r.status !== 0) throw new Error(`${what} failed (exit ${r.status}).`); return r; };
const psql = (args, opts) => run('psql', [DB_URL, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args], opts);

function prepare(extra) {
  must(run('bash', ['scripts/local-db.sh', 'reset', '--yes', '--version', LEGACY_VERSION, '--no-seed']), 'reset to the legacy schema');
  const seed = must(run('git', ['show', `${LEGACY_REF}:backend/supabase/seed.sql`], { quiet: true }), 'reading the legacy seed').stdout;
  must(psql(['-1'], { input: seed, quiet: true }), 'loading the legacy seed');
  must(psql(['-f', join(REHEARSAL, extra)]), `loading ${extra}`);
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
    console.log('\n== Rehearsal 1: legacy goals, JSON scorers, awkward minutes and score-only matches');
    prepare('legacy_match_events_fixture.sql');
    const err = applyNewer();
    if (err) throw new Error(`migration ${err.file} failed:\n${err.error}`);
    must(psql(['-f', join(REHEARSAL, 'match_events.check.sql')]), 'the rehearsal assertions');

    console.log('\n== Rehearsal 2: more goal rows than the score must stop the migration');
    prepare('legacy_match_events_blocker.sql');
    const stop = applyNewer();
    if (!stop || !/more goal rows than the recorded score/.test(stop.error)) throw new Error(`expected the migration to stop on the blocker, got: ${stop ? stop.error : 'no error'}`);
    const left = must(psql(['-At', '-c', "SELECT to_regclass('public.match_events') IS NULL AND to_regclass('public.goals') IS NOT NULL"], { quiet: true }), 'checking the stopped migration');
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

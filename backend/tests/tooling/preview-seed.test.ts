// Group: tooling. scripts/preview-seed.sh seeds and verifies the Preview (staging) project from the deploy
// workflow. It must refuse anything that is not the linked staging project, keep the database password out of
// command lines and output, and report clearly. Uses a fake psql: no database is touched.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const script = join(__dirname, '../../../scripts/preview-seed.sh');
const STG = 'abcdefghijklmnopqrst';
const PROD = 'zzzzzzzzzzzzzzzzzzzz';
const PASSWORD = 'correct-horse-battery-staple';

let dir: string;
let log: string;
let summary: string;

function setup(opts: { linked?: string; pooler?: string; psqlBehaviour?: string } = {}) {
  dir = mkdtempSync(join(tmpdir(), 'preview-seed-'));
  log = join(dir, 'psql.log');
  summary = join(dir, 'summary.md');
  const backend = join(dir, 'backend');
  mkdirSync(join(backend, 'supabase/.temp'), { recursive: true });
  writeFileSync(join(backend, 'supabase/.temp/project-ref'), opts.linked ?? STG);
  writeFileSync(
    join(backend, 'supabase/.temp/pooler-url'),
    opts.pooler ?? `postgresql://postgres.${STG}@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres`,
  );
  const psql = join(dir, 'fake-psql');
  // Records the arguments and whether a password was supplied (never its value), then answers by file name.
  writeFileSync(
    psql,
    `#!/usr/bin/env bash
echo "ARGS: $*" >> "${log}"
echo "PGPASSWORD set: $([ -n "\${PGPASSWORD:-}" ] && echo yes || echo no)" >> "${log}"
case "$*" in
  *verify-preview.sql*) ${opts.psqlBehaviour === 'fail-check' ? `printf 'check_name,passed\\nteams: at least 24,t\\nevery division has a live match,f\\n'` : `printf 'check_name,passed\\nteams: at least 24,t\\nevery division has a live match,t\\n'`} ;;
  *verify-captain-rpc.sql*) printf 'check_name,passed\\nanonymous callers cannot execute,t\\n' ;;
  *seed.sql*) ${opts.psqlBehaviour === 'fail-seed' ? 'echo "ERROR: boom" >&2; exit 3' : 'exit 0'} ;;
  *) printf 'table_name,rows\\nteams,24\\nmatches,168\\n' ;;
esac
${opts.psqlBehaviour === 'fail-psql' ? 'exit 2' : 'exit 0'}
`,
  );
  chmodSync(psql, 0o755);
  return { backend, psql };
}

function run(mode: string, env: Record<string, string | undefined> = {}, opts: Parameters<typeof setup>[0] = {}) {
  const { backend, psql } = setup(opts);
  return spawnSync('bash', [script, mode], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      PREVIEW_BACKEND_DIR: backend,
      PREVIEW_PSQL: psql,
      GITHUB_STEP_SUMMARY: summary,
      SUPABASE_PROJECT_REF: STG,
      PRODUCTION_PROJECT_REF: PROD,
      SUPABASE_DB_PASSWORD: PASSWORD,
      ...env,
    } as unknown as NodeJS.ProcessEnv,
  });
}

const psqlCalls = () => (existsSync(log) ? readFileSync(log, 'utf8') : '');
const summaryText = () => (existsSync(summary) ? readFileSync(summary, 'utf8') : '');

beforeEach(() => {
  dir = '';
});

describe('preview-seed.sh guards (nothing may reach psql when a guard fails)', () => {
  it.each(['seed', 'verify'])('%s refuses when the staging reference equals the production reference', (mode) => {
    const r = run(mode, { SUPABASE_PROJECT_REF: PROD }, { linked: PROD, pooler: `postgresql://postgres.${PROD}@aws-1-x.pooler.supabase.com:5432/postgres` });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/production/i);
    expect(psqlCalls()).toBe('');
  });

  it.each(['seed', 'verify'])('%s refuses when the production reference is not provided', (mode) => {
    const r = run(mode, { PRODUCTION_PROJECT_REF: '' });
    expect(r.status).not.toBe(0);
    expect(psqlCalls()).toBe('');
  });

  it.each(['seed', 'verify'])('%s refuses when the linked project is not the configured staging project', (mode) => {
    const r = run(mode, {}, { linked: 'otherotherotherother' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/linked/i);
    expect(psqlCalls()).toBe('');
  });

  it.each(['seed', 'verify'])("%s refuses a connection address that is not this project's pooler", (mode) => {
    const r = run(mode, {}, { pooler: `postgresql://postgres.${PROD}@aws-1-x.pooler.supabase.com:5432/postgres` });
    expect(r.status).not.toBe(0);
    expect(psqlCalls()).toBe('');
  });

  it('refuses without a database password', () => {
    const r = run('seed', { SUPABASE_DB_PASSWORD: '' });
    expect(r.status).not.toBe(0);
    expect(psqlCalls()).toBe('');
  });

  it('refuses an unknown mode', () => {
    expect(run('reset').status).not.toBe(0);
    expect(psqlCalls()).toBe('');
  });
});

describe('preview-seed.sh seed', () => {
  it('runs the existing seed file once, stopping at the first error, with the password only in the environment', () => {
    const r = run('seed');
    expect(r.status).toBe(0);
    const calls = psqlCalls();
    expect(calls).toContain('seed.sql');
    expect(calls).toContain('ON_ERROR_STOP=1');
    expect(calls).toContain('PGPASSWORD set: yes');
    expect(calls).not.toContain(PASSWORD);
    expect(calls).not.toMatch(/postgresql:\/\/[^@\s]*:[^@\s]*@/); // no user:password@ in the address
    expect(summaryText()).toMatch(/Seed: PASSED/);
  });

  it('reports a failing seed and exits non-zero', () => {
    const r = run('seed', {}, { psqlBehaviour: 'fail-seed' });
    expect(r.status).not.toBe(0);
    expect(summaryText()).toMatch(/Seed: FAILED/);
  });

  it('never prints or writes the password', () => {
    for (const behaviour of [undefined, 'fail-seed']) {
      const r = run('seed', {}, { psqlBehaviour: behaviour });
      expect(r.stdout + r.stderr + summaryText()).not.toContain(PASSWORD);
    }
  });
});

describe('preview-seed.sh verify', () => {
  it('passes when every check is true and says so in the summary', () => {
    const r = run('verify');
    expect(r.status).toBe(0);
    expect(summaryText()).toMatch(/Verification: PASSED/);
    expect(summaryText()).toContain('every division has a live match');
    expect(psqlCalls()).toContain('verify-preview.sql');
    expect(psqlCalls()).toContain('verify-captain-rpc.sql');
  });

  it('fails and names the failing check when any check is false', () => {
    const r = run('verify', {}, { psqlBehaviour: 'fail-check' });
    expect(r.status).not.toBe(0);
    expect(summaryText()).toMatch(/Verification: FAILED/);
    expect(summaryText()).toMatch(/every division has a live match.*FAIL/);
  });

  it('fails when psql itself fails, instead of reporting a pass on empty output', () => {
    const r = run('verify', {}, { psqlBehaviour: 'fail-psql' });
    expect(r.status).not.toBe(0);
    expect(summaryText()).not.toMatch(/Verification: PASSED/);
  });

  it('never prints or writes the password', () => {
    const r = run('verify');
    expect(r.stdout + r.stderr + summaryText()).not.toContain(PASSWORD);
  });
});

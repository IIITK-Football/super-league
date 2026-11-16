// Group: tooling. scripts/local-db.sh must target only this repo's local DB on 54322,
// fail fast, and gate destructive operations. Uses a fake Supabase CLI (no real DB touched).
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const script = join(__dirname, '../../../scripts/local-db.sh');
let dir: string;
let log: string;

function fakeCli(statusUrl: string | null) {
  const cli = join(dir, 'fake-supabase');
  writeFileSync(
    cli,
    `#!/usr/bin/env bash
echo "$@" >> "${log}"
if [ "$1" = "status" ]; then
  ${statusUrl ? `printf '{\\n  "API_URL": "http://127.0.0.1:54321",\\n  "DB_URL": "${statusUrl}"\\n}\\n'` : 'echo "docker not running" >&2; exit 1'}
fi
exit 0
`,
  );
  chmodSync(cli, 0o755);
  return cli;
}

function backendDir(port = '54322', project = 'backend') {
  const b = join(dir, 'backend');
  mkdirSync(join(b, 'supabase'), { recursive: true });
  writeFileSync(join(b, 'supabase/config.toml'), `project_id = "${project}"\n[api]\nport = 54321\n[db]\nport = ${port}\nshadow_port = 54320\n`);
  return b;
}

function run(args: string[], opts: { url?: string | null; port?: string; project?: string } = {}) {
  const url = opts.url === undefined ? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' : opts.url;
  return spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    input: '',
    env: {
      PATH: process.env.PATH,
      LOCAL_DB_SUPABASE_CMD: fakeCli(url),
      LOCAL_DB_BACKEND_DIR: backendDir(opts.port, opts.project),
      LOCAL_DB_SKIP_PORT_CHECK: '1',
    },
  });
}

const calls = () => (existsSync(log) ? readFileSync(log, 'utf8') : '');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'localdb-'));
  log = join(dir, 'calls.log');
});

describe('local-db.sh', () => {
  it('status passes for the local project on 54322', () => {
    const r = run(['status']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('54322');
  });

  it('fails when the stack is unreachable and does not report success', () => {
    const r = run(['status'], { url: null });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toMatch(/ok|success/i);
  });

  it('refuses a different database port (e.g. the backup project on 55322)', () => {
    const r = run(['reset', '--yes'], { url: 'postgresql://postgres:postgres@127.0.0.1:55322/postgres' });
    expect(r.status).not.toBe(0);
    expect(calls()).not.toContain('db reset');
  });

  it('refuses a non-local host', () => {
    const r = run(['reset', '--yes'], { url: 'postgresql://postgres:pw@db.example.supabase.co:5432/postgres' });
    expect(r.status).not.toBe(0);
    expect(calls()).not.toContain('db reset');
  });

  it('refuses when config.toml does not use port 54322 or project_id backend', () => {
    expect(run(['status'], { port: '55322' }).status).not.toBe(0);
    expect(run(['status'], { project: 'superLeagueBackup' }).status).not.toBe(0);
  });

  it('reset prints the target and requires confirmation', () => {
    const r = run(['reset']);
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toContain('127.0.0.1:54322');
    expect(calls()).not.toContain('db reset');
  });

  it('reset --yes runs a local-only reset', () => {
    const r = run(['reset', '--yes']);
    expect(r.status).toBe(0);
    expect(calls()).toContain('db reset --local');
    expect(calls()).not.toContain('--linked');
  });

  it('rejects unknown commands and forwarded flags', () => {
    expect(run(['reset', '--yes', '--linked']).status).not.toBe(0);
    expect(run(['push']).status).not.toBe(0);
    expect(calls()).not.toMatch(/push|--linked/);
  });

  it('never suppresses errors or targets hosted projects', () => {
    const src = readFileSync(script, 'utf8');
    expect(src).toMatch(/set -euo pipefail/);
    expect(src).not.toMatch(/\|\|\s*true/);
    expect(src).not.toMatch(/2>\s*\/dev\/null/);
    expect(src).not.toMatch(/db push|db pull|link\b/);
    expect(src).not.toMatch(/docker (rm|stop|kill|volume|system|network)/);
  });
});

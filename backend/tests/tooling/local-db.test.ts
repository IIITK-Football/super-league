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
if [ "$1" = "start" ]; then
  echo "google-client-id=$SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID google-secret=$SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET" >> "${log}"
  echo "captcha-secret=$SUPABASE_AUTH_CAPTCHA_SECRET" >> "${log}"
  touch "${dir}/started"
fi
if [ "$1" = "status" ] && [ -n "$STATUS_AFTER_START" ] && [ ! -f "${dir}/started" ]; then
  echo "not running" >&2; exit 1
fi
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

function run(args: string[], opts: { url?: string | null; port?: string; project?: string; env?: Record<string, string>; supabaseEnvFile?: string } = {}) {
  const url = opts.url === undefined ? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' : opts.url;
  const backend = backendDir(opts.port, opts.project);
  if (opts.supabaseEnvFile !== undefined) writeFileSync(join(backend, 'supabase/.env'), opts.supabaseEnvFile);
  return spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    input: '',
    env: {
      PATH: process.env.PATH,
      LOCAL_DB_SUPABASE_CMD: fakeCli(url),
      LOCAL_DB_BACKEND_DIR: backend,
      LOCAL_DB_SKIP_PORT_CHECK: '1',
      ...opts.env,
    } as unknown as NodeJS.ProcessEnv,
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

  it('start works without Google credentials by passing placeholders to the CLI', () => {
    const r = run(['start'], { env: { STATUS_AFTER_START: '1' } });
    expect(r.status).toBe(0);
    expect(calls()).toMatch(/google-client-id=\S+ google-secret=\S+/);
    expect(calls()).toContain('start');
  });

  it('start keeps real Google credentials from the environment', () => {
    const r = run(['start'], {
      env: { STATUS_AFTER_START: '1', SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: 'real-id', SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: 'real-secret' },
    });
    expect(r.status).toBe(0);
    expect(calls()).toContain('google-client-id=real-id google-secret=real-secret');
  });

  it('start does not override credentials defined in supabase/.env', () => {
    const r = run(['start'], {
      env: { STATUS_AFTER_START: '1' },
      supabaseEnvFile: 'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=from-file\nSUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=from-file-secret\n',
    });
    expect(r.status).toBe(0);
    expect(calls()).toContain('google-client-id= google-secret=');
  });

  it('start uses Cloudflare\'s published always-pass test secret for Turnstile when none is set', () => {
    const r = run(['start'], { env: { STATUS_AFTER_START: '1' } });
    expect(r.status).toBe(0);
    expect(calls()).toContain('captcha-secret=1x0000000000000000000000000000000AA');
  });

  it('start keeps a real Turnstile secret from the environment', () => {
    const r = run(['start'], { env: { STATUS_AFTER_START: '1', SUPABASE_AUTH_CAPTCHA_SECRET: 'real-turnstile-secret' } });
    expect(r.status).toBe(0);
    expect(calls()).toContain('captcha-secret=real-turnstile-secret');
    expect(calls()).not.toContain('1x0000000000000000000000000000000AA');
  });

  it('start does not override a Turnstile secret defined in supabase/.env', () => {
    const r = run(['start'], { env: { STATUS_AFTER_START: '1' }, supabaseEnvFile: 'SUPABASE_AUTH_CAPTCHA_SECRET=from-file\n' });
    expect(r.status).toBe(0);
    expect(calls()).toContain('captcha-secret=\n');
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

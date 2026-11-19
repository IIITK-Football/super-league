// Group: tooling. scripts/production-history-repair.sh marks the two baseline migrations as applied on the PRODUCTION
// project and checks that exactly the repository's later migrations remain pending. The owner runs it; it reads the connection
// string with hidden input, verifies the target project, never prints or stores the string, and stops on any surprise.
// Tested with a fake Supabase CLI: nothing here touches a real database.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const root = join(__dirname, '../../..');
const script = join(root, 'scripts/production-history-repair.sh');
const PROD = 'obkxfepdpdufxawhzaen';
const STAGING = 'yecozsiccsfwphlmxozt';
const PASSWORD = 'Sup3rS3cret-pw';
const POOLER = `postgresql://postgres.${PROD}:${PASSWORD}@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres`;
const DIRECT = `postgresql://postgres:${PASSWORD}@db.${PROD}.supabase.co:5432/postgres`;

// Every repository migration after the baseline is pending on production until the first production deploy.
const LATER = readdirSync(join(root, 'backend/supabase/migrations')).filter((f) => f.endsWith('.sql'))
  .map((f) => f.split('_')[0]).filter((v) => !['20261106000000', '20261106180125'].includes(v)).sort();
const LIST_GOOD = [
  '        Local        |       Remote        | Time (UTC)',
  '---------------------|---------------------|---------------------',
  ' 20261106000000      | 20261106000000      | 2026-11-06 00:00:00',
  ' 20261106180125      | 20261106180125      | 2026-11-06 18:01:25',
  ...LATER.map((v) => ` ${v}      |                     | 2026-11-17 00:00:00`),
].join('\n');

let dir: string;
let log: string;

function fakeCli(listOut: string) {
  dir = mkdtempSync(join(tmpdir(), 'repair-'));
  log = join(dir, 'calls.log');
  const cli = join(dir, 'fake-supabase');
  const listFile = join(dir, 'list.txt');
  writeFileSync(listFile, listOut);
  // Records the arguments with the connection string replaced, so the log itself is safe to read in the test.
  writeFileSync(
    cli,
    `#!/usr/bin/env bash
args=()
for a in "$@"; do args+=("\${a//${PASSWORD}/<pw>}"); done
echo "\${args[*]}" >> "${log}"
for a in "$@"; do
  case "$a" in
    postgres*://*)
      u="\${a#*://}"; ui="\${u%@*}"; pw="\${ui#*:}"
      case "$pw" in *[!A-Za-z0-9%._~-]*) echo "pwsafe=no" >> "${log}";; *) echo "pwsafe=yes" >> "${log}";; esac
      echo "url-host=\${u##*@}" >> "${log}" ;;
  esac
done
case "$*" in
  *"migration list"*) cat "${listFile}" ;;
esac
exit 0
`,
  );
  chmodSync(cli, 0o755);
  return cli;
}

function run(url: string, listOut = LIST_GOOD, extraInput = '') {
  const cli = fakeCli(listOut);
  return spawnSync('bash', [script], {
    cwd: root,
    input: `${url}\n${extraInput}`,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, PRODUCTION_REPAIR_SUPABASE_CMD: cli } as unknown as NodeJS.ProcessEnv,
  });
}
const calls = () => (existsSync(log) ? readFileSync(log, 'utf8') : '');
const everything = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr;

beforeEach(() => {
  log = '';
});

describe('target verification (no CLI call may happen for a wrong target)', () => {
  it('refuses the staging project', () => {
    const r = run(POOLER.replace(PROD, STAGING));
    expect(r.status).not.toBe(0);
    expect(everything(r)).toMatch(/not the production project/i);
    expect(calls()).toBe('');
  });

  it('refuses an unknown project, a local database and the backup stack', () => {
    for (const url of [
      POOLER.replace(PROD, 'abcdefghijklmnopqrst'),
      `postgresql://postgres:${PASSWORD}@127.0.0.1:54322/postgres`,
      `postgresql://postgres:${PASSWORD}@127.0.0.1:55322/postgres`,
      'not a url at all',
      '',
    ]) {
      const r = run(url);
      expect(r.status, url).not.toBe(0);
      expect(calls(), url).toBe('');
    }
  });

  it('refuses a string that names production in the user but a different host (a mixed-up paste)', () => {
    const r = run(`postgresql://postgres.${PROD}:${PASSWORD}@db.${STAGING}.supabase.co:5432/postgres`);
    expect(r.status).not.toBe(0);
    expect(calls()).toBe('');
  });

  it('accepts both connection forms for the production project', () => {
    for (const url of [POOLER, DIRECT]) {
      const r = run(url);
      expect(r.status, url).toBe(0);
    }
  });
});

describe('the repair', () => {
  it('marks exactly the two baseline migrations as applied, against the supplied database, and lists the result', () => {
    const r = run(POOLER);
    expect(r.status).toBe(0);
    const c = calls();
    expect(c).toMatch(/migration repair --status applied 20261106000000 --db-url <pw>|migration repair --status applied 20261106000000 --db-url postgresql:\/\/postgres\.[a-z]+:<pw>@/);
    expect(c).toMatch(/migration repair --status applied 20261106180125/);
    expect(c).toMatch(/migration list/);
    expect(c).not.toMatch(/--status reverted/); // never removes history rows by itself
    expect(c).not.toMatch(/--linked|db push|db reset/);
  });

  it('succeeds only when exactly the repository\'s later migrations are pending', () => {
    const r = run(POOLER);
    expect(r.status).toBe(0);
    expect(LATER.length).toBeGreaterThan(2);
    for (const v of LATER) expect(everything(r)).toMatch(new RegExp(v));
    expect(everything(r)).toMatch(new RegExp(`exactly the ${LATER.length} expected migrations`, 'i'));
  });

  it('stops when a later migration is missing from the pending list', () => {
    const missing = LIST_GOOD.split('\n').filter((l) => !l.includes(LATER[LATER.length - 1])).join('\n');
    const r = run(POOLER, missing);
    expect(r.status).not.toBe(0);
    expect(everything(r)).toMatch(/does not match/i);
  });

  it('stops and says what differs when anything else is pending', () => {
    const extra = `${LIST_GOOD}\n 20271231000000      |                     | 2027-12-31 00:00:00`;
    const r = run(POOLER, extra);
    expect(r.status).not.toBe(0);
    expect(everything(r)).toMatch(/20271231000000/);
    expect(everything(r)).toMatch(/does not match/i);
  });

  it('stops when the baseline is still listed as pending', () => {
    const baselinePending = LIST_GOOD.replace(' 20261106000000      | 20261106000000      |', ' 20261106000000      |                     |');
    const r = run(POOLER, baselinePending);
    expect(r.status).not.toBe(0);
    expect(everything(r)).toMatch(/20261106000000/);
  });

  it('stops when production has a version with no local file (to be handled deliberately, never reverted automatically)', () => {
    const remoteOnly = `${LIST_GOOD}\n                     | 20250101000000      | 2025-01-01 00:00:00`;
    const r = run(POOLER, remoteOnly);
    expect(r.status).not.toBe(0);
    expect(everything(r)).toMatch(/20250101000000/);
    expect(everything(r)).toMatch(/no local file|remote-only/i);
  });
});

describe('connection string problems are fixed or explained BEFORE anything connects', () => {
  const RAW = 'p@ss:w/rd#1?x';

  it('percent-encodes a password that contains characters which break a connection string', () => {
    const r = run(`postgresql://postgres.${PROD}:${RAW}@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres`);
    expect(r.status).toBe(0);
    expect(calls()).toMatch(/pwsafe=yes/);
    expect(calls()).not.toMatch(/pwsafe=no/);
    expect(everything(r)).not.toContain(RAW);
  });

  it('asks for the password separately (hidden) when the string has none, and encodes it', () => {
    const r = run(`postgresql://postgres.${PROD}@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres`, LIST_GOOD, `${RAW}\n`);
    expect(r.status).toBe(0);
    expect(calls()).toMatch(/pwsafe=yes/);
    expect(everything(r)).not.toContain(RAW);
  });

  it('treats the dashboard placeholder as "no password yet" instead of sending it', () => {
    const r = run(`postgresql://postgres.${PROD}:[YOUR-PASSWORD]@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres`, LIST_GOOD, `${RAW}\n`);
    expect(r.status).toBe(0);
    expect(calls()).not.toContain('YOUR-PASSWORD');
    expect(calls()).toMatch(/pwsafe=yes/);
  });

  it('removes quotes, spaces and carriage returns picked up when pasting', () => {
    const r = run(`  "${POOLER}"\r  `);
    expect(r.status).toBe(0);
    expect(calls()).toMatch(/migration repair/);
  });

  it('refuses the transaction-mode pooler port (6543), which cannot run migration commands', () => {
    const r = run(POOLER.replace(':5432', ':6543'));
    expect(r.status).not.toBe(0);
    expect(everything(r)).toMatch(/6543/);
    expect(everything(r)).toMatch(/5432/);
    expect(calls()).toBe('');
  });

  it('uses the session port 5432 when none is given', () => {
    const r = run(`postgresql://postgres.${PROD}:${PASSWORD}@aws-1-ap-southeast-2.pooler.supabase.com/postgres`);
    expect(r.status).toBe(0);
    expect(calls()).toMatch(/url-host=aws-1-ap-southeast-2\.pooler\.supabase\.com:5432\/postgres/);
  });

  it('says exactly what is wrong with the string, without echoing it', () => {
    const r = run(`postgresql://postgres.${PROD}:${PASSWORD}@/postgres`);
    expect(r.status).not.toBe(0);
    expect(everything(r)).not.toContain(PASSWORD);
    expect(calls()).toBe('');
  });

  it('states the backup evidence is the existing backup files and that the script never connects to that project', () => {
    const out = everything(run(POOLER));
    expect(out).toMatch(/existing backup files/i);
    expect(out).toMatch(/never connects/i);
  });
});

describe('the connection string stays private', () => {
  it('is never printed, in success or in any failure', () => {
    for (const [url, list] of [
      [POOLER, LIST_GOOD],
      [DIRECT, LIST_GOOD],
      [POOLER, `${LIST_GOOD}\n 20261120000000 | | x`],
      [POOLER.replace(PROD, STAGING), LIST_GOOD],
    ] as const) {
      const r = run(url, list);
      expect(everything(r), url).not.toContain(PASSWORD);
    }
  });

  it('is read with hidden input and is never written to a file or traced', () => {
    const src = readFileSync(script, 'utf8');
    expect(src).toMatch(/read -r?s/);
    expect(src).not.toMatch(/set -[a-z]*x/);
    expect(src).not.toMatch(/>\s*["']?[^&\s"']*\.(env|txt|log)/);
    run(POOLER);
    // everything the run left behind (the fake CLI's own source legitimately holds the test password, to mask it in its log)
    for (const f of readdirSync(dir).filter((x) => x !== 'fake-supabase')) expect(readFileSync(join(dir, f), 'utf8'), f).not.toContain(PASSWORD);
  });

  it('states which backup the owner chose, without inspecting it', () => {
    expect(everything(run(POOLER))).toMatch(/superLeagueBackup/);
  });
});

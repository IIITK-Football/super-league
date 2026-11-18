// Group: tooling. The `pnpm work` commands (scripts/work/cli.mjs): approve, ready, start, attest, status and the
// CI-facing check. Each runs against a throwaway backlog; check --base runs against a real temporary Git history.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
// @ts-ignore plain ESM
import { run } from '../../../scripts/work/cli.mjs';
// @ts-ignore plain ESM
import { sha256 } from '../../../scripts/work/backlog.mjs';

let root: string;
let out: string[];
let err: string[];

const PLAN = '# Plan\n## Issue\nx\n## Evidence\nx\n## Scope\nx\n## Acceptance checks\nx\n## Tests\nx\n## Rollback\nx\n';
const write = (rel: string, content: string) => {
  const p = join(root, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, content);
};
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

function item(id: string, o: { status?: string; phase?: number; legacy?: boolean; manual?: boolean; plan?: boolean } = {}) {
  const checks = [
    '  - id: C1',
    '    text: "It works"',
    '    verify: test:backend/tests/tooling/example.test.ts',
    ...(o.manual ? ['  - id: C2', '    text: "Owner confirms"', '    verify: manual:owner'] : []),
  ];
  write(
    `backlog/items/${id}.md`,
    ['---', `id: ${id}`, `title: "Title ${id}"`, `phase: ${o.phase ?? 1}`, `status: ${o.status ?? 'not-started'}`, ...(o.legacy ? ['legacy: true'] : []),
      'dependsOn: []', 'decisions: []', 'groups: [tooling]', ...(o.plan === false ? [] : [`plan: docs/plans/${id}.md`]), 'checks:', ...checks, '---', 'body', ''].join('\n'),
  );
}

const cli = (...argv: string[]) => run(argv, { root, out: (s: string) => out.push(s), err: (s: string) => err.push(s), user: 'Owner Name', now: () => new Date('2026-11-17T12:00:00Z') });
const said = () => [...out, ...err].join('\n');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'work-'));
  out = [];
  err = [];
  write('tests/groups.json', JSON.stringify({ groups: { tooling: { description: 't', owner: 'platform', paths: ['x/**'], covers: ['x/**'], testPaths: ['backend/tests/tooling/**'], run: [{ cwd: '.', cmd: ['true'] }] } } }));
  write('backlog/decisions.json', JSON.stringify({ decisions: [] }));
  write('backlog/rules.json', JSON.stringify({ rules: [] }));
  write('backend/tests/tooling/example.test.ts', '//\n');
  write('docs/plans/SL-100.md', PLAN);
});

describe('approve', () => {
  it('records the owner and the hash of exactly this plan', () => {
    item('SL-100');
    expect(cli('approve', 'SL-100')).toBe(0);
    const a = JSON.parse(read('backlog/approvals/SL-100.json'));
    expect(a).toMatchObject({ id: 'SL-100', approvedBy: 'Owner Name', approvedAt: '2026-11-17T12:00:00.000Z', planSha256: sha256(PLAN) });
  });

  it('refuses an incomplete plan and an unknown item', () => {
    item('SL-100');
    write('docs/plans/SL-100.md', '# Plan\n## Issue\nx\n');
    expect(cli('approve', 'SL-100')).toBe(1);
    expect(said()).toMatch(/missing the "Evidence" section/);
    expect(existsSync(join(root, 'backlog/approvals/SL-100.json'))).toBe(false);
    expect(cli('approve', 'SL-999')).toBe(1);
  });
});

describe('status of a superseded item', () => {
  it('names the items it was folded into instead of claiming it never existed', () => {
    item('SL-100');
    write('backlog/superseded.json', JSON.stringify({ superseded: [{ id: 'SL-101', by: ['SL-100'], date: '2026-11-18', note: 'merged into the full slice' }] }));
    expect(cli('status', 'SL-101')).toBe(1);
    expect(said()).toMatch(/SL-101: superseded by SL-100 \(2026-11-18\): merged into the full slice/);
    expect(cli('start', 'SL-101')).toBe(1);
  });
});

describe('ready and start', () => {
  it('needs the approval, then moves the item to ready and on to in-progress', () => {
    item('SL-100');
    expect(cli('ready', 'SL-100')).toBe(1);
    expect(said()).toMatch(/not approved/);
    expect(read('backlog/items/SL-100.md')).toMatch(/status: not-started/);
    cli('approve', 'SL-100');
    expect(cli('ready', 'SL-100')).toBe(0);
    expect(read('backlog/items/SL-100.md')).toMatch(/status: ready/);
    expect(cli('start', 'SL-100')).toBe(0);
    expect(read('backlog/items/SL-100.md')).toMatch(/status: in-progress/);
  });

  it('an item starts straight from not-started with no plan or approval, and records where it began', () => {
    item('SL-100', { plan: false });
    expect(cli('start', 'SL-100')).toBe(0);
    expect(read('backlog/items/SL-100.md')).toMatch(/status: in-progress/);
  });

  it('refuses to start an item in a later phase while an earlier phase is open', () => {
    item('SL-050', { phase: 1, status: 'in-progress', legacy: true });
    item('SL-200', { phase: 2 });
    expect(cli('start', 'SL-200')).toBe(1);
    expect(said()).toMatch(/phase 1 is still open: SL-050/);
    expect(read('backlog/items/SL-200.md')).toMatch(/status: not-started/);
    expect(cli('ready', 'SL-200')).toBe(1);
  });

  it('refuses to start a finished or already running item', () => {
    item('SL-100', { status: 'in-progress', legacy: true });
    expect(cli('start', 'SL-100')).toBe(1);
    expect(said()).toMatch(/not-started or ready/);
  });

  it('changes only the status line of the item file', () => {
    item('SL-100');
    cli('approve', 'SL-100');
    const before = read('backlog/items/SL-100.md');
    cli('ready', 'SL-100');
    expect(read('backlog/items/SL-100.md')).toBe(before.replace('status: not-started', 'status: ready'));
  });
});

describe('attest', () => {
  it('records a manual check once the item is in progress', () => {
    item('SL-100', { status: 'in-progress', legacy: true, manual: true });
    expect(cli('attest', 'SL-100', 'C2', 'Applied on staging')).toBe(0);
    const a = JSON.parse(read('backlog/attestations/SL-100.json'));
    expect(a.attestations).toEqual([{ checkId: 'C2', by: 'Owner Name', at: '2026-11-17T12:00:00.000Z', note: 'Applied on staging' }]);
  });

  it('refuses automated checks, unknown checks and items that are not in progress', () => {
    item('SL-100', { status: 'in-progress', legacy: true, manual: true });
    expect(cli('attest', 'SL-100', 'C1')).toBe(1);
    expect(said()).toMatch(/not a manual check/);
    expect(cli('attest', 'SL-100', 'C9')).toBe(1);
    item('SL-101', { status: 'ready', manual: true });
    expect(cli('attest', 'SL-101', 'C2')).toBe(1);
  });

  it('attesting the same check again replaces the earlier record', () => {
    item('SL-100', { status: 'in-progress', legacy: true, manual: true });
    cli('attest', 'SL-100', 'C2', 'first');
    cli('attest', 'SL-100', 'C2', 'second');
    expect(JSON.parse(read('backlog/attestations/SL-100.json')).attestations).toHaveLength(1);
    expect(read('backlog/attestations/SL-100.json')).toMatch(/second/);
  });
});

describe('status', () => {
  it('summarises the backlog and explains what an item still needs', () => {
    item('SL-100');
    expect(cli('status')).toBe(0);
    expect(said()).toMatch(/not-started\s+1/);
    out = [];
    expect(cli('status', 'SL-100')).toBe(0);
    expect(said()).toMatch(/not approved/);
  });
});

describe('check', () => {
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  const commit = (m: string) => {
    git('add', '-A');
    git('-c', 'user.email=t@t.test', '-c', 'user.name=T', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', m);
  };

  it('validates the backlog without a base', () => {
    item('SL-100');
    expect(cli('check')).toBe(0);
    write('backlog/items/SL-101.md', '---\nid: SL-101\ntitle: x\nphase: 1\nstatus: nonsense\ndependsOn: []\ndecisions: []\ngroups: []\n---\n');
    expect(cli('check')).toBe(1);
    expect(said()).toMatch(/SL-101: status "nonsense"/);
  });

  it('accepts the first commit of a backlog (bootstrap) but then judges every status change', () => {
    git('init', '-q', '-b', 'develop');
    write('README.md', 'x\n');
    commit('chore: start');
    const base0 = git('rev-parse', 'HEAD');
    item('SL-100', { status: 'in-progress', legacy: true });
    commit('feat: backlog');
    expect(cli('check', '--base', base0)).toBe(0);

    const base1 = git('rev-parse', 'HEAD');
    item('SL-100', { status: 'done', legacy: true });
    item('SL-101', { status: 'not-started' });
    item('SL-102', { status: 'not-started' });
    commit('feat: more');
    const base2 = git('rev-parse', 'HEAD');
    item('SL-102', { status: 'done' });
    item('SL-101', { status: 'in-progress' });
    commit('feat: skip everything');
    out = [];
    err = [];
    expect(cli('check', '--base', base1)).toBe(1);
    expect(said()).toMatch(/SL-101: new item cannot start as in-progress/);
    out = [];
    err = [];
    expect(cli('check', '--base', base2)).toBe(1);
    expect(said()).toMatch(/SL-102: status cannot change from not-started to done/);
  });

  it('rejects a change to ready that has no approval, and a done item without its walkthrough and evidence', () => {
    git('init', '-q', '-b', 'develop');
    item('SL-100');
    item('SL-101', { status: 'in-progress', legacy: true });
    commit('feat: backlog');
    const base = git('rev-parse', 'HEAD');
    item('SL-100', { status: 'ready' });
    item('SL-101', { status: 'done', legacy: true });
    commit('feat: advance');
    expect(cli('check', '--base', base)).toBe(1);
    const text = said();
    expect(text).toMatch(/SL-100: .*not approved/);
    expect(text).toMatch(/SL-101: .*walkthrough docs\/walkthroughs\/SL-101\.md, which is missing/);
    expect(text).toMatch(/SL-101: .*evidence backlog\/evidence\/SL-101\.json, which is missing/);
  });
});

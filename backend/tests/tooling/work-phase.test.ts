// Group: tooling. `work phase N`: the rigid validation, done once when a phase is completed (not on every commit).
// It checks every item's prerequisites up front, applies the strict file rules to the whole phase, runs every active
// test group ONCE, and writes evidence and walkthroughs for all items together. Test runners are injected.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
// @ts-ignore plain ESM
import { run } from '../../../scripts/work/cli.mjs';

let root: string;
let out: string[];
let err: string[];
let groupResult: 'passed' | 'failed';
let ranGroups: string[][];

const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const write = (rel: string, content: string) => {
  const p = join(root, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, content);
};
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const commit = (m: string) => {
  git('add', '-A');
  git('-c', 'user.email=t@t.test', '-c', 'user.name=T', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', m);
};

function item(id: string, status: string, manual = false) {
  const checks = ['  - id: C1', '    text: "It works"', '    verify: test:backend/tests/tooling/example.test.ts', ...(manual ? ['  - id: C2', '    text: "Owner confirms"', '    verify: manual:owner'] : [])];
  write(`backlog/items/${id}.md`, ['---', `id: ${id}`, 'title: "Thing"', 'phase: 1', `status: ${status}`, 'legacy: true', 'dependsOn: []', 'decisions: []', 'groups: [tooling]', 'checks:', ...checks, '---', 'body', ''].join('\n'));
}

const cli = (...argv: string[]) =>
  run(argv, {
    root,
    out: (s: string) => out.push(s),
    err: (s: string) => err.push(s),
    user: 'Owner Name',
    now: () => new Date('2026-11-17T12:00:00Z'),
    runGroups: (groups: string[]) => {
      ranGroups.push(groups);
      return { head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), clean: true, dryRun: false, at: '2026-11-17T12:00:00Z', groups: groups.map((g) => ({ name: g, state: groupResult, note: '', commands: [{ cwd: '.', cmd: 'run', exit: groupResult === 'passed' ? 0 : 1, ms: 1 }] })) };
    },
    runCommand: () => ({ exit: 0 }),
  });
const said = () => [...out, ...err].join('\n');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'phase-'));
  out = [];
  err = [];
  groupResult = 'passed';
  ranGroups = [];
  git('init', '-q', '-b', 'develop');
  write('tests/groups.json', JSON.stringify({ groups: { tooling: { description: 't', owner: 'platform', paths: ['x/**'], covers: ['x/**'], testPaths: ['backend/tests/tooling/**'], run: [{ cwd: '.', cmd: ['true'] }] } } }));
  write('tests/gate-exemptions.json', JSON.stringify({ exemptions: [{ glob: '**/*.md', reason: 'docs' }, { glob: 'backlog/**', reason: 'records' }] }));
  write('backlog/decisions.json', JSON.stringify({ decisions: [] }));
  write('backlog/rules.json', JSON.stringify({ rules: [{ id: 'R1', text: 'rule one', enforcement: 'attest' }] }));
  write('backend/tests/tooling/example.test.ts', '//\n');
  write('README.md', 'x\n');
  commit('chore: start');
});

const two = (manual = false) => {
  item('SL-100', 'in-progress', manual);
  item('SL-101', 'in-progress');
  commit('feat: two items');
};
const base = () => git('rev-parse', 'HEAD~1');

function fillNarrative(id: string) {
  write(`docs/walkthroughs/${id}.md`, read(`docs/walkthroughs/${id}.md`).replace(/TODO[^\n]*/g, 'Written up.').replace(/^- (R\d+): .*$/gm, '- $1: pass'));
  commit('docs: walkthrough');
}

describe('work phase', () => {
  it('refuses while an item in the phase has not been started', () => {
    item('SL-102', 'not-started');
    commit('feat: not started');
    expect(cli('phase', '1', '--base', 'HEAD~1')).toBe(1);
    expect(said()).toMatch(/SL-102 \(not-started\)/);
    expect(ranGroups).toEqual([]);
  });

  it('needs a base to judge the phase against', () => {
    two();
    expect(cli('phase', '1')).toBe(1);
    expect(said()).toMatch(/--base/);
  });

  it('lists every missing attestation across the phase before running anything', () => {
    two(true);
    expect(cli('phase', '1', '--base', base())).toBe(1);
    expect(said()).toMatch(/SL-100: C2: manual check not attested/);
    expect(ranGroups).toEqual([]);
  });

  it('applies the strict file rules to the whole phase: a changed source file needs a changed test', () => {
    two();
    write('x/a.ts', 'export const a = 1;\n');
    commit('feat: untested source');
    expect(cli('phase', '1', '--base', git('rev-parse', 'HEAD~2'))).toBe(1);
    expect(said()).toMatch(/x\/a\.ts.*changed or added test/);
    expect(ranGroups).toEqual([]);
  });

  it('runs every active group ONCE for the whole phase, then writes evidence and a walkthrough for each item', () => {
    two();
    expect(cli('phase', '1', '--base', base())).toBe(1);
    expect(ranGroups).toEqual([['tooling']]);
    for (const id of ['SL-100', 'SL-101']) {
      expect(existsSync(join(root, `backlog/evidence/${id}.json`))).toBe(true);
      expect(existsSync(join(root, `docs/walkthroughs/${id}.md`))).toBe(true);
    }
    expect(said()).toMatch(/Fill in/);
  });

  it('a failing group fails the phase and records nothing', () => {
    two();
    groupResult = 'failed';
    expect(cli('phase', '1', '--base', base())).toBe(1);
    expect(existsSync(join(root, 'backlog/evidence/SL-100.json'))).toBe(false);
  });

  it('completes the phase once every walkthrough is written', () => {
    two();
    const b = base();
    expect(cli('phase', '1', '--base', b)).toBe(1);
    commit('feat: evidence and skeletons');
    fillNarrative('SL-100');
    fillNarrative('SL-101');
    out = [];
    err = [];
    expect(cli('phase', '1', '--base', b)).toBe(0);
    expect(said()).toMatch(/Phase 1 is complete/);
    expect(read('backlog/items/SL-100.md')).toMatch(/status: done/);
    expect(read('backlog/items/SL-101.md')).toMatch(/status: done/);
  });

  it('says so when the phase is already complete', () => {
    item('SL-100', 'legacy-done');
    commit('feat: legacy');
    expect(cli('phase', '1', '--base', 'HEAD~1')).toBe(0);
    expect(said()).toMatch(/already complete/);
  });
});

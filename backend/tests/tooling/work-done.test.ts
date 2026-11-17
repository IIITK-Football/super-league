// Group: tooling. Definition of Done and the completion walkthrough (scripts/work/walkthrough.mjs, `work done`).
// Test runners are injected, so these tests prove the gate's decisions without running the real groups.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
// @ts-ignore plain ESM
import { run } from '../../../scripts/work/cli.mjs';
// @ts-ignore plain ESM
import { loadBacklog } from '../../../scripts/work/backlog.mjs';
// @ts-ignore plain ESM
import * as wt from '../../../scripts/work/walkthrough.mjs';

let root: string;
let out: string[];
let err: string[];
let groupResult: 'passed' | 'failed';
let commandExit: number;
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

function item(id: string, status: string, extra: { manual?: boolean; command?: boolean } = {}) {
  const checks = [
    '  - id: C1',
    '    text: "It works"',
    '    verify: test:backend/tests/tooling/example.test.ts',
    ...(extra.manual ? ['  - id: C2', '    text: "Owner confirms"', '    verify: manual:owner'] : []),
    ...(extra.command ? ['  - id: C3', '    text: "Probe passes"', '    verify: command:node probe.mjs'] : []),
  ];
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
      return { head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), clean: true, dryRun: false, at: '2026-11-17T12:00:00Z', groups: groups.map((g) => ({ name: g, state: groupResult, note: '', commands: [{ cwd: '.', cmd: 'pnpm exec vitest run', exit: groupResult === 'passed' ? 0 : 1, ms: 5 }] })) };
    },
    runCommand: () => ({ exit: commandExit }),
  });
const said = () => [...out, ...err].join('\n');

const RULES = [{ id: 'R1', text: 'rule one', enforcement: 'attest' }, { id: 'R2', text: 'rule two', enforcement: 'attest' }];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'done-'));
  out = [];
  err = [];
  groupResult = 'passed';
  commandExit = 0;
  ranGroups = [];
  git('init', '-q', '-b', 'develop');
  write('tests/groups.json', JSON.stringify({ groups: { tooling: { description: 't', owner: 'platform', paths: ['x/**'], covers: ['x/**'], testPaths: ['backend/tests/tooling/**'], run: [{ cwd: '.', cmd: ['true'] }] } } }));
  write('tests/gate-exemptions.json', JSON.stringify({ exemptions: [{ glob: '**/*.md', reason: 'docs' }, { glob: 'backlog/**', reason: 'records' }] }));
  write('backlog/decisions.json', JSON.stringify({ decisions: [] }));
  write('backlog/rules.json', JSON.stringify({ rules: RULES }));
  write('backend/tests/tooling/example.test.ts', '//\n');
  write('README.md', 'x\n');
  commit('chore: start');
  item('SL-100', 'in-progress');
  commit('feat: backlog');
});

function fillNarrative(id: string) {
  let text = read(`docs/walkthroughs/${id}.md`);
  text = text.replace(/TODO[^\n]*/g, 'Written up.').replace(/^- (R\d+): .*$/gm, '- $1: pass');
  write(`docs/walkthroughs/${id}.md`, text);
  commit('docs: walkthrough');
}

describe('walkthrough module', () => {
  const evidence = { head: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true, groups: [{ name: 'tooling', state: 'passed', commands: [{ cwd: '.', cmd: 'pnpm exec vitest run', exit: 0, ms: 1 }] }] };
  const ctx = () => {
    item('SL-100', 'in-progress', { manual: true });
    const bl = loadBacklog(root);
    return { item: bl.items.get('SL-100'), bl, evidence, commits: [{ sha: 'c'.repeat(40), subject: 'feat(x): y' }], files: ['x/a.ts'], attestations: [{ checkId: 'C2', by: 'Owner', at: '2026-11-17T00:00:00Z', note: 'ok' }] };
  };

  it('a new skeleton lists every section, every check and every cross-cutting rule', () => {
    const text = wt.buildSkeleton(ctx());
    for (const s of wt.SECTIONS) expect(text, s).toContain(`## ${s}`);
    expect(text).toMatch(/C1/);
    expect(text).toMatch(/C2/);
    expect(text).toMatch(/- R1:/);
    expect(text).toMatch(/- R2:/);
    expect(text).toContain(evidence.head);
  });

  it('an unfilled skeleton does not pass', () => {
    const c = ctx();
    const problems = wt.walkthroughProblems(wt.buildSkeleton(c), c);
    expect(problems.join('\n')).toMatch(/Summary[\s\S]*TODO|TODO[\s\S]*Summary/);
  });

  const filled = (c: any) => wt.buildSkeleton(c).replace(/TODO[^\n]*/g, 'Done.').replace(/^- (R\d+): .*$/gm, '- $1: pass');

  it('a filled-in walkthrough passes', () => {
    const c = ctx();
    expect(wt.walkthroughProblems(filled(c), c)).toEqual([]);
  });

  it('every cross-cutting rule needs pass, or n/a with a reason', () => {
    const c = ctx();
    expect(wt.walkthroughProblems(filled(c).replace('- R2: pass\n', ''), c).join('\n')).toMatch(/rule R2/);
    expect(wt.walkthroughProblems(filled(c).replace('- R2: pass', '- R2: n/a'), c).join('\n')).toMatch(/R2: n\/a needs a reason/);
    expect(wt.walkthroughProblems(filled(c).replace('- R2: pass', '- R2: n/a: no data model change in this item'), c)).toEqual([]);
  });

  it('a walkthrough recorded against other evidence is stale', () => {
    const c = ctx();
    const text = filled(c);
    const problems = wt.walkthroughProblems(text, { ...c, evidence: { ...evidence, head: 'd'.repeat(40) } });
    expect(problems.join('\n')).toMatch(/stale/);
  });

  it('refreshing rewrites the generated facts and keeps what the author wrote', () => {
    const c = ctx();
    const text = filled(c).replace('Written', 'Written').replace(/## Summary\n\n[^\n]*/, '## Summary\n\nMy own summary.');
    const refreshed = wt.refreshGenerated(text, { ...c, evidence: { ...evidence, head: 'e'.repeat(40) } });
    expect(refreshed).toContain('e'.repeat(40));
    expect(refreshed).toContain('My own summary.');
    expect(refreshed).not.toContain('a'.repeat(40));
  });

  it('shows a missing manual attestation as unmet', () => {
    const c = { ...ctx(), attestations: [] };
    expect(wt.walkthroughProblems(wt.buildSkeleton(c).replace(/TODO[^\n]*/g, 'x').replace(/^- (R\d+): .*$/gm, '- $1: pass'), c).join('\n')).toMatch(/C2.*not attested/);
  });
});

describe('work done', () => {
  it('refuses an item that is not in progress', () => {
    item('SL-100', 'ready');
    commit('feat: ready');
    expect(cli('done', 'SL-100', '--base', 'HEAD~1')).toBe(1);
    expect(said()).toMatch(/must be in-progress/);
  });

  it('refuses when a tracked, non-exempt file has uncommitted changes', () => {
    write('backend/tests/tooling/example.test.ts', '// changed\n');
    expect(cli('done', 'SL-100', '--base', 'HEAD~1')).toBe(1);
    expect(said()).toMatch(/uncommitted changes/);
    expect(ranGroups).toEqual([]);
  });

  it('ignores uncommitted changes to exempt files (the owner may keep personal edits)', () => {
    write('README.md', 'edited\n');
    expect(cli('done', 'SL-100', '--base', 'HEAD~1')).toBe(1); // still stops at the unfilled walkthrough, not at the edit
    expect(said()).not.toMatch(/uncommitted changes/);
  });

  it('needs --base for an item with no recorded start', () => {
    expect(cli('done', 'SL-100')).toBe(1);
    expect(said()).toMatch(/--base/);
  });

  it('first run runs the groups, writes the evidence and a skeleton, and leaves the status alone', () => {
    expect(cli('done', 'SL-100', '--base', 'HEAD~1')).toBe(1);
    expect(ranGroups).toEqual([['tooling']]);
    expect(existsSync(join(root, 'backlog/evidence/SL-100.json'))).toBe(true);
    expect(existsSync(join(root, 'docs/walkthroughs/SL-100.md'))).toBe(true);
    expect(said()).toMatch(/Fill in/);
    expect(read('backlog/items/SL-100.md')).toMatch(/status: in-progress/);
  });

  it('a failing group fails the gate and never marks the item done', () => {
    groupResult = 'failed';
    expect(cli('done', 'SL-100', '--base', 'HEAD~1')).toBe(1);
    expect(said()).toMatch(/group tooling failed/);
    expect(read('backlog/items/SL-100.md')).toMatch(/status: in-progress/);
  });

  it('a manual check needs the owner\'s attestation', () => {
    item('SL-100', 'in-progress', { manual: true });
    commit('feat: manual check');
    expect(cli('done', 'SL-100', '--base', 'HEAD~2')).toBe(1);
    expect(said()).toMatch(/C2.*not attested/);
  });

  it('a failing command check fails the gate', () => {
    item('SL-100', 'in-progress', { command: true });
    commit('feat: command check');
    commandExit = 3;
    expect(cli('done', 'SL-100', '--base', 'HEAD~2')).toBe(1);
    expect(said()).toMatch(/C3.*failed/);
  });

  it('once the walkthrough is written the second run records the item as done, and CI accepts it', () => {
    const base = git('rev-parse', 'HEAD~1');
    expect(cli('done', 'SL-100', '--base', base)).toBe(1);
    commit('feat: evidence and skeleton');
    fillNarrative('SL-100');
    out = [];
    err = [];
    expect(cli('done', 'SL-100', '--base', base)).toBe(0);
    expect(read('backlog/items/SL-100.md')).toMatch(/status: done/);
    expect(read('backlog/items/SL-100.md')).toMatch(/walkthrough: docs\/walkthroughs\/SL-100\.md/);
    commit('feat: done');
    out = [];
    err = [];
    expect(cli('check', '--base', base)).toBe(0);
  });

  it('CI rejects a done item whose evidence was not clean, or whose walkthrough was never filled in', () => {
    const base = git('rev-parse', 'HEAD~1');
    cli('done', 'SL-100', '--base', base);
    commit('feat: evidence');
    fillNarrative('SL-100');
    cli('done', 'SL-100', '--base', base);
    commit('feat: done');
    const ev = JSON.parse(read('backlog/evidence/SL-100.json'));
    write('backlog/evidence/SL-100.json', JSON.stringify({ ...ev, clean: false }));
    commit('chore: tamper');
    out = [];
    err = [];
    expect(cli('check', '--base', base)).toBe(1);
    expect(said()).toMatch(/evidence was not recorded on a clean tree/);
  });
});

describe('evidence after history was rewritten', () => {
  function finishedItem() {
    const base = git('rev-parse', 'HEAD~1');
    cli('done', 'SL-100', '--base', base);
    commit('feat: evidence and skeleton');
    fillNarrative('SL-100');
    cli('done', 'SL-100', '--base', base);
    commit('feat: done');
    return base;
  }

  it('still accepts evidence whose commit hash is gone when a commit with the same tree is in the history', () => {
    const base = finishedItem();
    const ev = JSON.parse(read('backlog/evidence/SL-100.json'));
    // simulate a rewrite: the evidence names a hash that no longer exists, but its tree (the content) does
    write('backlog/evidence/SL-100.json', JSON.stringify({ ...ev, head: '1'.repeat(40) }));
    write('docs/walkthroughs/SL-100.md', read('docs/walkthroughs/SL-100.md').replace(ev.head, '1'.repeat(40)));
    commit('chore: simulate a rewritten hash');
    out = [];
    err = [];
    expect(cli('check', '--base', base)).toBe(0);
  });

  it('rejects evidence whose commit hash AND tree are both unknown to this history', () => {
    const base = finishedItem();
    const ev = JSON.parse(read('backlog/evidence/SL-100.json'));
    write('backlog/evidence/SL-100.json', JSON.stringify({ ...ev, head: '1'.repeat(40), tree: '2'.repeat(40) }));
    commit('chore: unknown evidence');
    out = [];
    err = [];
    expect(cli('check', '--base', base)).toBe(1);
    expect(said()).toMatch(/evidence commit/);
  });
});

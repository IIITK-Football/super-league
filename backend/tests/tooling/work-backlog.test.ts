// Group: tooling. The backlog model behind `pnpm work` (scripts/work/backlog.mjs): schema validation, phase gating,
// Definition of Ready and the status transitions CI accepts. Uses throwaway backlogs; the real one is checked at the end.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
// @ts-ignore plain ESM
import * as backlog from '../../../scripts/work/backlog.mjs';

const real = join(__dirname, '../../..');
let root: string;

const PLAN = `# Plan
## Issue
x
## Evidence
x
## Scope
x
## Acceptance checks
x
## Tests
x
## Rollback
x
`;

function write(rel: string, content: string) {
  const p = join(root, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, content);
}

function item(id: string, extra: Record<string, unknown> = {}, body = 'body\n') {
  const m: any = { id, title: `Title ${id}`, phase: 1, status: 'not-started', dependsOn: [], decisions: [], groups: [], ...extra };
  const lines = ['---', `id: ${m.id}`, `title: ${JSON.stringify(m.title)}`, `phase: ${m.phase}`, `status: ${m.status}`];
  if (m.legacy) lines.push('legacy: true');
  lines.push(`dependsOn: [${m.dependsOn.join(', ')}]`, `decisions: [${m.decisions.join(', ')}]`, `groups: [${m.groups.join(', ')}]`);
  if (m.plan) lines.push(`plan: ${m.plan}`);
  if (m.checks?.length) {
    lines.push('checks:');
    for (const c of m.checks) lines.push(`  - id: ${c.id}`, `    text: ${JSON.stringify(c.text)}`, `    verify: ${c.verify}`);
  }
  lines.push('---');
  write(`backlog/items/${id}.md`, `${lines.join('\n')}\n${body}`);
}

const checks = [{ id: 'C1', text: 'It works', verify: 'test:backend/tests/tooling/example.test.ts' }];
const ready = (id: string, extra: Record<string, unknown> = {}) => item(id, { groups: ['tooling'], checks, plan: `docs/plans/${id}.md`, ...extra });
const approve = (id: string, planText = PLAN) =>
  write(`backlog/approvals/${id}.json`, JSON.stringify({ id, planSha256: createHash('sha256').update(planText).digest('hex'), approvedBy: 'Owner', approvedAt: '2026-11-17T00:00:00Z' }));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'backlog-'));
  write('tests/groups.json', JSON.stringify({
    groups: {
      tooling: { description: 't', owner: 'platform', paths: ['x/**'], covers: ['x/**'], testPaths: ['backend/tests/tooling/**'], run: [{ cwd: '.', cmd: ['true'] }] },
      later: { description: 'l', owner: 'backend', status: 'pending', pendingFor: 'SL-9', paths: ['y/**'], run: [] },
    },
  }));
  write('backlog/decisions.json', JSON.stringify({ decisions: [{ id: 'D-01', question: 'q', status: 'open', items: [] }, { id: 'D-02', question: 'q', status: 'resolved', resolution: 'docs/decisions/D-02.md', items: [] }] }));
  write('backlog/rules.json', JSON.stringify({ rules: [{ id: 'R1', text: 'rule', enforcement: 'attest' }] }));
  write('backend/tests/tooling/example.test.ts', '// test\n');
  write('docs/plans/SL-100.md', PLAN);
});

describe('validateBacklog', () => {
  it('accepts a well-formed backlog', () => {
    item('SL-100');
    expect(backlog.validateBacklog(backlog.loadBacklog(root))).toEqual([]);
  });

  it('rejects an id that does not match its file name, an unknown status and an unknown group', () => {
    item('SL-100', { status: 'finished', groups: ['nope'] });
    write('backlog/items/SL-101.md', '---\nid: SL-102\ntitle: x\nphase: 1\nstatus: not-started\ndependsOn: []\ndecisions: []\ngroups: []\n---\n');
    const out = backlog.validateBacklog(backlog.loadBacklog(root)).join('\n');
    expect(out).toMatch(/SL-100: status "finished"/);
    expect(out).toMatch(/SL-100: unknown group "nope"/);
    expect(out).toMatch(/SL-101: id SL-102 does not match/);
  });

  it('rejects references to items and decisions that do not exist', () => {
    item('SL-100', { dependsOn: ['SL-999'], decisions: ['D-99'] });
    const out = backlog.validateBacklog(backlog.loadBacklog(root)).join('\n');
    expect(out).toMatch(/depends on unknown item SL-999/);
    expect(out).toMatch(/unknown decision D-99/);
  });

  it('only legacy items may be legacy-done', () => {
    item('SL-100', { status: 'legacy-done' });
    expect(backlog.validateBacklog(backlog.loadBacklog(root)).join('\n')).toMatch(/legacy-done is only for items closed before the workflow/);
  });

  it('a ready or in-progress item needs groups and checks', () => {
    item('SL-100', { status: 'in-progress' });
    const out = backlog.validateBacklog(backlog.loadBacklog(root)).join('\n');
    expect(out).toMatch(/SL-100: in-progress items need at least one test group/);
    expect(out).toMatch(/SL-100: in-progress items need acceptance checks/);
  });

  it('checks need unique ids and a recognised verification', () => {
    item('SL-100', { groups: ['tooling'], checks: [{ id: 'C1', text: 'a', verify: 'vibes' }, { id: 'C1', text: 'b', verify: 'manual:owner' }] });
    const out = backlog.validateBacklog(backlog.loadBacklog(root)).join('\n');
    expect(out).toMatch(/verify "vibes"/);
    expect(out).toMatch(/duplicate check id C1/);
  });

  it('a resolved decision must point at a record', () => {
    write('backlog/decisions.json', JSON.stringify({ decisions: [{ id: 'D-01', question: 'q', status: 'resolved', items: [] }] }));
    item('SL-100');
    expect(backlog.validateBacklog(backlog.loadBacklog(root)).join('\n')).toMatch(/D-01: a resolved decision needs a resolution/);
  });
});

describe('phase gating (do not start the next phase)', () => {
  it('blocks an item while any item in an earlier phase is not complete', () => {
    item('SL-100', { phase: 1, status: 'in-progress', legacy: true, groups: ['tooling'], checks });
    ready('SL-200', { phase: 2 });
    const bl = backlog.loadBacklog(root);
    expect(backlog.phaseGateProblems(bl.items.get('SL-200'), bl).join('\n')).toMatch(/phase 1 is still open: SL-100/);
  });

  it('allows it once the earlier phases are done or legacy-done, and never blocks the same phase', () => {
    item('SL-100', { phase: 1, status: 'legacy-done', legacy: true });
    item('SL-101', { phase: 2 });
    ready('SL-200', { phase: 2 });
    const bl = backlog.loadBacklog(root);
    expect(backlog.phaseGateProblems(bl.items.get('SL-200'), bl)).toEqual([]);
  });
});

describe('Definition of Ready', () => {
  it('passes for a complete, approved item', () => {
    ready('SL-100');
    approve('SL-100');
    const bl = backlog.loadBacklog(root);
    expect(backlog.readyProblems(bl.items.get('SL-100'), bl, { root })).toEqual([]);
  });

  it('lists every unmet condition at once', () => {
    item('SL-100', { dependsOn: ['SL-101'], decisions: ['D-01'] });
    item('SL-101');
    const bl = backlog.loadBacklog(root);
    const out = backlog.readyProblems(bl.items.get('SL-100'), bl, { root }).join('\n');
    expect(out).toMatch(/depends on SL-101, which is not done/);
    expect(out).toMatch(/decision D-01 is still open/);
    expect(out).toMatch(/needs at least one test group/);
    expect(out).toMatch(/needs acceptance checks/);
    expect(out).toMatch(/needs a plan/);
  });

  it('rejects a pending test group: it would verify nothing', () => {
    ready('SL-100', { groups: ['later'] });
    approve('SL-100');
    const bl = backlog.loadBacklog(root);
    expect(backlog.readyProblems(bl.items.get('SL-100'), bl, { root }).join('\n')).toMatch(/group "later" is pending/);
  });

  it('rejects a test check whose file does not exist or is not a test of the item\'s groups', () => {
    ready('SL-100', { checks: [{ id: 'C1', text: 'a', verify: 'test:backend/tests/tooling/missing.test.ts' }, { id: 'C2', text: 'b', verify: 'test:frontend/x.test.js' }] });
    approve('SL-100');
    write('frontend/x.test.js', '//\n');
    const bl = backlog.loadBacklog(root);
    const out = backlog.readyProblems(bl.items.get('SL-100'), bl, { root }).join('\n');
    expect(out).toMatch(/C1: test file backend\/tests\/tooling\/missing\.test\.ts does not exist/);
    expect(out).toMatch(/C2: .* is not a test of this item's groups/);
  });

  it('requires a plan with every section filled in', () => {
    ready('SL-100');
    write('docs/plans/SL-100.md', '# Plan\n## Issue\nx\n## Evidence\n\n## Scope\nx\n');
    approve('SL-100', '# Plan\n## Issue\nx\n## Evidence\n\n## Scope\nx\n');
    const bl = backlog.loadBacklog(root);
    const out = backlog.readyProblems(bl.items.get('SL-100'), bl, { root }).join('\n');
    expect(out).toMatch(/plan section "Evidence" is empty/);
    expect(out).toMatch(/plan is missing the "Acceptance checks" section/);
  });

  it('requires the owner\'s approval of exactly this plan, and a changed plan needs a new approval', () => {
    ready('SL-100');
    let bl = backlog.loadBacklog(root);
    expect(backlog.readyProblems(bl.items.get('SL-100'), bl, { root }).join('\n')).toMatch(/not approved/);
    approve('SL-100');
    write('docs/plans/SL-100.md', `${PLAN}\nsneaky extra scope\n`);
    bl = backlog.loadBacklog(root);
    expect(backlog.readyProblems(bl.items.get('SL-100'), bl, { root }).join('\n')).toMatch(/plan changed after it was approved/);
  });

  it('a legacy item is not asked for a plan or an approval', () => {
    item('SL-100', { legacy: true, status: 'in-progress', groups: ['tooling'], checks });
    const bl = backlog.loadBacklog(root);
    expect(backlog.readyProblems(bl.items.get('SL-100'), bl, { root })).toEqual([]);
  });
});

describe('transitions', () => {
  const t = (from: string | null, to: string, extra: object = {}) =>
    backlog.transitionProblems(from, to, { bootstrap: false, ...extra });

  it('allows the normal path and a block', () => {
    expect(t('not-started', 'ready')).toEqual([]);
    expect(t('ready', 'in-progress')).toEqual([]);
    expect(t('in-progress', 'done')).toEqual([]);
    expect(t('in-progress', 'blocked')).toEqual([]);
    expect(t('blocked', 'in-progress')).toEqual([]);
    expect(t('ready', 'not-started')).toEqual([]);
  });

  it('refuses to skip steps, to reopen a finished item, or to invent legacy-done', () => {
    expect(t('not-started', 'in-progress').join()).toMatch(/not-started to in-progress/);
    expect(t('not-started', 'done').join()).toMatch(/not-started to done/);
    expect(t('done', 'in-progress').join()).toMatch(/done to in-progress/);
    expect(t('legacy-done', 'in-progress').join()).toMatch(/legacy-done to in-progress/);
    expect(t('not-started', 'legacy-done').join()).toMatch(/legacy-done/);
  });

  it('a new item must start as not-started, except when the backlog is first created', () => {
    expect(t(null, 'not-started')).toEqual([]);
    expect(t(null, 'done').join()).toMatch(/new item/);
    expect(t(null, 'done', { bootstrap: true })).toEqual([]);
  });

  it('no change is always fine', () => {
    expect(t('in-progress', 'in-progress')).toEqual([]);
  });
});

describe('the real backlog', () => {
  it('is valid', () => {
    expect(backlog.validateBacklog(backlog.loadBacklog(real))).toEqual([]);
  });

  it('kept every item from the original backlog', () => {
    const bl = backlog.loadBacklog(real);
    expect(bl.items.size).toBeGreaterThanOrEqual(65);
    for (const id of ['SL-001', 'SL-018', 'SL-020', 'SL-075', 'SL-103']) expect(bl.items.has(id), id).toBe(true);
  });
});

// Group: tooling. The CI `gate` (the one required check) and `pnpm work audit`, which verifies that the enforcement is
// really in place: repository files, this clone's hooks, and (read-only) the GitHub rules.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
// @ts-ignore plain ESM
import { auditLocal, auditRemote, auditRepo } from '../../../scripts/work/audit.mjs';

const real = join(__dirname, '../../..');
const ci = readFileSync(join(real, '.github/workflows/ci.yml'), 'utf8');

function jobs(source: string): Record<string, string> {
  const start = source.indexOf('\njobs:\n');
  const out: Record<string, string> = {};
  let current: string | null = null;
  for (const line of source.slice(start + 7).split('\n')) {
    const m = line.match(/^ {2}([a-z][\w-]*):\s*$/);
    if (m) {
      current = m[1];
      out[current] = '';
    } else if (current) out[current] += `${line}\n`;
  }
  return out;
}
const j = jobs(ci);

describe('ci.yml: one required check called gate', () => {
  it('runs on pull requests to develop and main, pushes and the nightly full run', () => {
    expect(ci).toMatch(/pull_request:\s*\n\s*branches: \[main, develop\]/);
    expect(ci).toMatch(/schedule:/);
    expect(ci).toMatch(/workflow_dispatch:/);
  });

  it('has the sub-jobs the gate depends on', () => {
    for (const name of ['hygiene', 'records', 'tests', 'audit', 'gate']) expect(Object.keys(j), name).toContain(name);
  });

  it('the gate waits for every sub-job even when one fails, and fails unless each one SUCCEEDED (a skipped job fails it)', () => {
    expect(j.gate).toMatch(/needs: \[hygiene, records, tests, audit\]/);
    expect(j.gate).toMatch(/if: \$\{\{ always\(\) \}\}/);
    for (const n of ['hygiene', 'records', 'tests', 'audit']) expect(j.gate, n).toContain(`needs.${n}.result`);
    expect(j.gate).toMatch(/!= ['"]?success/);
  });

  it('nothing in the workflow can hide a failure', () => {
    expect(ci).not.toMatch(/continue-on-error/);
    expect(ci).not.toMatch(/\|\|\s*true/);
    expect(ci).not.toMatch(/if: false/);
  });

  it('judges commits with the same hygiene code as the hooks, over the whole range', () => {
    expect(j.hygiene).toMatch(/scripts\/hooks\/hygiene\.mjs/);
    expect(j.hygiene).toMatch(/fetch-depth: 0/);
  });

  it('checks every backlog status change since the base, and walkthroughs of done items', () => {
    expect(j.records).toMatch(/scripts\/work\/cli\.mjs check --base/);
  });

  it('applies the strict test rules before running the affected groups, on every kind of run', () => {
    expect(j.tests).toMatch(/test-groups\.mjs check --base/);
    expect(j.tests).toMatch(/frozen-lockfile/);
    expect(j.tests).toMatch(/needs_db/);
  });

  it('runs the repository half of the audit', () => {
    expect(j.audit).toMatch(/scripts\/work\/audit\.mjs --repo/);
  });

  it('does not reference secrets: the gate must work for every pull request', () => {
    expect(ci).not.toMatch(/secrets\./);
  });
});

describe('the GitHub ruleset template', () => {
  const template = JSON.parse(readFileSync(join(real, 'docs/process/ruleset-gate.json'), 'utf8'));
  const types = template.rules.map((r: { type: string }) => r.type);

  it('requires a pull request, the gate check, linear history, and forbids force pushes and deletion', () => {
    for (const t of ['pull_request', 'required_status_checks', 'required_linear_history', 'non_fast_forward', 'deletion']) expect(types, t).toContain(t);
    const checks = template.rules.find((r: { type: string }) => r.type === 'required_status_checks').parameters.required_status_checks;
    expect(checks.map((c: { context: string }) => c.context)).toEqual(['gate']);
  });

  it('covers develop and main and has an EMPTY bypass list, so it binds administrators too', () => {
    expect(template.conditions.ref_name.include.sort()).toEqual(['refs/heads/develop', 'refs/heads/main']);
    expect(template.bypass_actors).toEqual([]);
    expect(template.enforcement).toBe('active');
  });

  it('is accepted by the remote audit', () => {
    const gh = (path: string) => (path.endsWith('/rulesets') ? [{ id: 1, name: 'Workflow gate', enforcement: 'active' }] : path.endsWith('/rulesets/1') ? template : path.includes('environments') ? { protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User' }] }] } : null);
    const results = auditRemote({ gh });
    expect(results.filter((r: { ok: boolean }) => !r.ok)).toEqual([]);
  });
});

describe('audit (remote, read-only)', () => {
  const template = JSON.parse(readFileSync(join(real, 'docs/process/ruleset-gate.json'), 'utf8'));
  const gh = (ruleset: unknown, reviewers = 1) => (path: string) =>
    path.endsWith('/rulesets') ? (ruleset ? [{ id: 1, name: 'r', enforcement: 'active' }] : []) : path.endsWith('/rulesets/1') ? ruleset : { protection_rules: reviewers ? [{ type: 'required_reviewers', reviewers: [{}] }] : [] };
  const failed = (results: { ok: boolean; name: string }[]) => results.filter((r) => !r.ok).map((r) => r.name).join('\n');

  it('fails when there is no ruleset', () => expect(failed(auditRemote({ gh: gh(null) }))).toMatch(/ruleset/i));

  it('fails when the ruleset can be bypassed', () => {
    const bypass = { ...template, bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }] };
    expect(failed(auditRemote({ gh: gh(bypass) }))).toMatch(/bypass/i);
  });

  it('fails when the gate is not a required check, or the ruleset is not active', () => {
    const noCheck = { ...template, rules: template.rules.filter((r: { type: string }) => r.type !== 'required_status_checks') };
    expect(failed(auditRemote({ gh: gh(noCheck) }))).toMatch(/required check/i);
    expect(failed(auditRemote({ gh: (p: string) => (p.endsWith('/rulesets') ? [{ id: 1, name: 'r', enforcement: 'evaluate' }] : gh(template)(p)) }))).toMatch(/active/i);
  });

  it('fails when develop or main is not covered', () => {
    const onlyDevelop = { ...template, conditions: { ref_name: { include: ['refs/heads/develop'], exclude: [] } } };
    expect(failed(auditRemote({ gh: gh(onlyDevelop) }))).toMatch(/main/);
  });

  it('fails when the production environment has no required reviewer', () => {
    expect(failed(auditRemote({ gh: gh(template, 0) }))).toMatch(/reviewer/i);
  });

  it('reports a clear failure, not a crash, when GitHub cannot be read', () => {
    const results = auditRemote({ gh: () => { throw new Error('offline'); } });
    expect(results.some((r: { ok: boolean }) => !r.ok)).toBe(true);
  });
});

describe('audit (this clone)', () => {
  let repo: string;
  const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'audit-'));
    git('init', '-q');
  });

  it('fails when the hooks are not installed, and passes once they are', () => {
    mkdirSync(join(repo, '.githooks'));
    for (const h of ['pre-commit', 'commit-msg', 'pre-push']) writeFileSync(join(repo, '.githooks', h), '#!/bin/sh\n', { mode: 0o755 });
    expect(auditLocal({ root: repo }).some((r: { ok: boolean }) => !r.ok)).toBe(true);
    git('config', '--local', 'core.hooksPath', '.githooks');
    expect(auditLocal({ root: repo }).filter((r: { ok: boolean }) => !r.ok)).toEqual([]);
  });

  it('fails when a hook file is not executable', () => {
    mkdirSync(join(repo, '.githooks'));
    for (const h of ['pre-commit', 'commit-msg', 'pre-push']) writeFileSync(join(repo, '.githooks', h), '#!/bin/sh\n', { mode: h === 'pre-push' ? 0o644 : 0o755 });
    git('config', '--local', 'core.hooksPath', '.githooks');
    expect(auditLocal({ root: repo }).map((r: { name: string }) => r.name).join('\n')).toMatch(/pre-push/);
  });
});

describe('audit (repository)', () => {
  it('passes for this repository', () => {
    const failed = auditRepo({ root: real }).filter((r: { ok: boolean }) => !r.ok);
    expect(failed.map((r: { name: string; detail?: string }) => `${r.name}: ${r.detail}`)).toEqual([]);
  });

  it('flags workflow files that Git would ignore, and an unmapped file', () => {
    const repo = mkdtempSync(join(tmpdir(), 'audit-repo-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    mkdirSync(join(repo, 'backlog/items'), { recursive: true });
    mkdirSync(join(repo, 'tests'), { recursive: true });
    writeFileSync(join(repo, '.gitignore'), 'backlog/\nCLAUDE.md\n');
    writeFileSync(join(repo, 'backlog/items/SL-001.md'), 'x\n');
    writeFileSync(join(repo, 'CLAUDE.md'), 'x\n');
    writeFileSync(join(repo, 'tests/groups.json'), JSON.stringify({ groups: {} }));
    writeFileSync(join(repo, 'mystery.ts'), 'x\n');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    const names = auditRepo({ root: repo }).filter((r: { ok: boolean }) => !r.ok).map((r: { name: string }) => r.name).join('\n');
    expect(names).toMatch(/ignored/i);
    expect(names).toMatch(/mapped/i);
  });
});

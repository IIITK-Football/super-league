// Group: tooling. Strict test-group rules (scripts/test-groups.mjs `check` / `--strict`). These are the rules that
// stop a change from going green having tested nothing; no flag lets an individual change opt out.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkStrict, loadExemptions, loadGroups, validateGroups } from '../../../scripts/test-groups.mjs';

const root = join(__dirname, '../../..');

const config = {
  groups: {
    api: {
      description: 'api',
      owner: 'backend',
      paths: ['svc/**'],
      covers: ['svc/api/**'],
      testPaths: ['svc/tests/**'],
      run: [{ cwd: '.', cmd: ['true'] }],
    },
    web: {
      description: 'web',
      owner: 'frontend',
      paths: ['web/**'],
      covers: ['web/src/**'],
      testPaths: ['web/src/**/__tests__/**'],
      run: [{ cwd: '.', cmd: ['true'] }],
    },
    later: {
      description: 'later',
      owner: 'backend',
      status: 'pending',
      pendingFor: 'SL-999',
      paths: ['svc/jobs/**'],
      run: [],
    },
  },
};
const exemptions = [{ glob: '**/*.md', reason: 'documentation' }];

describe('checkStrict', () => {
  it('passes a source change that comes with a test in a group that covers it', () => {
    expect(checkStrict(['svc/api/a.ts', 'svc/tests/a.test.ts'], config, exemptions).errors).toEqual([]);
  });

  it('rejects a source change with no changed test', () => {
    const { errors } = checkStrict(['svc/api/a.ts'], config, exemptions);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/svc\/api\/a\.ts/);
    expect(errors[0]).toMatch(/changed or added test/);
    expect(errors[0]).toMatch(/api/);
  });

  it('does not accept a test from an unrelated group', () => {
    const { errors } = checkStrict(['svc/api/a.ts', 'web/src/x/__tests__/x.test.js'], config, exemptions);
    expect(errors.some((e) => e.includes('svc/api/a.ts'))).toBe(true);
  });

  it('rejects a file that no group maps at all', () => {
    const { errors } = checkStrict(['mystery/file.ts'], config, exemptions);
    expect(errors[0]).toMatch(/mystery\/file\.ts.*no group/i);
  });

  it('rejects a file that only a pending group maps, naming what is pending', () => {
    const { errors } = checkStrict(['svc/jobs/run.ts'], config, exemptions);
    expect(errors[0]).toMatch(/svc\/jobs\/run\.ts/);
    expect(errors[0]).toMatch(/no active tests cover/i);
    expect(errors[0]).toMatch(/SL-999/);
  });

  it('lets documentation and other approved categories through without a test', () => {
    expect(checkStrict(['docs/a.md'], config, exemptions).errors).toEqual([]);
  });

  it('at commit stage, the changed-test rule is deferred to the whole range, but unmapped and uncovered files are still rejected', () => {
    expect(checkStrict(['svc/api/a.ts'], config, exemptions, { requireTests: false }).errors).toEqual([]);
    expect(checkStrict(['mystery/file.ts'], config, exemptions, { requireTests: false }).errors).toHaveLength(1);
    expect(checkStrict(['svc/jobs/run.ts'], config, exemptions, { requireTests: false }).errors).toHaveLength(1);
  });

  it('accepts a test-only change', () => {
    expect(checkStrict(['svc/tests/a.test.ts'], config, exemptions).errors).toEqual([]);
  });

  it('reports every problem, not just the first', () => {
    const { errors } = checkStrict(['svc/api/a.ts', 'mystery/x.ts', 'svc/jobs/j.ts'], config, exemptions);
    expect(errors).toHaveLength(3);
  });

  it('an empty change set has nothing to reject', () => {
    expect(checkStrict([], config, exemptions).errors).toEqual([]);
  });
});

describe('validateGroups (strict fields)', () => {
  it('requires active groups to declare what they cover and which files are their tests', () => {
    const bad = { groups: { g: { description: 'g', owner: 'backend', paths: ['a/**'], run: [{ cwd: '.', cmd: ['true'] }] } } };
    const errors = validateGroups(bad, root);
    expect(errors.join('\n')).toMatch(/g: active groups need covers/);
    expect(errors.join('\n')).toMatch(/g: active groups need testPaths/);
  });

  it('does not let a pending group claim coverage', () => {
    const bad = { groups: { p: { description: 'p', owner: 'backend', status: 'pending', pendingFor: 'SL-1', paths: ['a/**'], covers: ['a/**'], run: [] } } };
    expect(validateGroups(bad, root).join('\n')).toMatch(/p: pending groups cannot cover/);
  });
});

describe('this repository', () => {
  const groups = loadGroups(join(root, 'tests/groups.json'));
  const ex = loadExemptions(join(root, 'tests/gate-exemptions.json'));

  it('has a valid groups file', () => {
    expect(validateGroups(groups, root)).toEqual([]);
  });

  it('maps every tracked file to a group or an approved exemption (zero unmapped)', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
    const unmapped = checkStrict(tracked, groups, ex, { onlyUnmapped: true }).errors;
    expect(unmapped).toEqual([]);
  });

  it('every exemption states a reason', () => {
    for (const e of ex) expect(e.reason, e.glob).toMatch(/\S{3,}/);
  });

  it('this very change set would be judged by the real rules (sanity: a lone route edit is rejected)', () => {
    const { errors } = checkStrict(['backend/app/api/matches/route.ts'], groups, ex);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('command line', () => {
  const run = (...args: string[]) => spawnSync('node', [join(root, 'scripts/test-groups.mjs'), ...args], { cwd: root, encoding: 'utf8' });

  it('check rejects an uncovered change with a non-zero exit and names the file', () => {
    const r = run('check', '--files', 'backend/app/api/matches/route.ts');
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/backend\/app\/api\/matches\/route\.ts/);
  });

  it('check accepts a documentation-only change', () => {
    const r = run('check', '--files', 'docs/auth.md');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/strict check passed/i);
  });

  it('check accepts a covered source change that includes its test', () => {
    const r = run('check', '--files', 'frontend/src/lib/authApi.js', 'frontend/src/lib/__tests__/authApi.test.js');
    expect(r.status).toBe(0);
  });

  it('affected --strict stops before running anything when the strict check fails', () => {
    const r = run('affected', '--strict', '--files', 'backend/app/api/matches/route.ts', '--dry-run');
    expect(r.status).toBe(1);
    expect(r.stdout).not.toMatch(/Test groups/);
  });

  it('writes machine-readable evidence that records the commit and the groups', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'evidence-')), 'e.json');
    const r = run('run', 'tooling', '--dry-run', '--evidence', out);
    expect(r.status).toBe(0);
    const e = JSON.parse(readFileSync(out, 'utf8'));
    expect(e.head).toMatch(/^[0-9a-f]{40}$/);
    expect(e.tree).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof e.clean).toBe('boolean');
    expect(e.dryRun).toBe(true);
    expect(e.groups.map((g: { name: string }) => g.name)).toEqual(['tooling']);
  });
});

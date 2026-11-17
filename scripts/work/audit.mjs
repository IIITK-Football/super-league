#!/usr/bin/env node
// Verifies that the enforcement is really in place. Read-only: it changes nothing anywhere.
//
//   node scripts/work/audit.mjs [--repo] [--local] [--remote]     (no flag = all three)
//
//   --repo    repository files: strict test mapping, backlog validity, workflow files tracked and not ignored,
//             the Claude guard wiring, the CI gate, no bypass switch.   (what CI runs)
//   --local   this clone: Git hooks installed and executable.
//   --remote  GitHub, through read-only `gh api` GET calls: a ruleset on develop and main that needs a pull request and
//             the `gate` check, forbids force pushes and deletion, has NO bypass actors; the production environment has
//             a required reviewer.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkStrict, loadExemptions, loadGroups, validateGroups } from '../test-groups.mjs';
import { loadBacklog, ROOT, validateBacklog } from './backlog.mjs';

const pass = (name) => ({ name, ok: true });
const fail = (name, detail) => ({ name, ok: false, detail });
const check = (name, problems) => (problems.length === 0 ? pass(name) : fail(name, problems.join('; ')));

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout.trim() };
}

const WORKFLOW_FILES = ['CLAUDE.md', '.claude/settings.json', 'tests/groups.json', 'tests/gate-exemptions.json', 'backlog/overview.md', 'backlog/rules.json', 'backlog/decisions.json', '.github/workflows/ci.yml', '.githooks/pre-commit', '.githooks/commit-msg', '.githooks/pre-push'];

function settingsProblems(root) {
  const file = join(root, '.claude/settings.json');
  if (!existsSync(file)) return ['.claude/settings.json is missing'];
  const s = JSON.parse(readFileSync(file, 'utf8'));
  const problems = [];
  const pre = JSON.stringify(s.hooks?.PreToolUse ?? []);
  for (const tool of ['Bash', 'Edit', 'Write']) if (!pre.includes(tool)) problems.push(`the guard is not wired to ${tool}`);
  if (!pre.includes('claude-guard.mjs pre-tool')) problems.push('the guard command is missing');
  if (!JSON.stringify(s.hooks?.SessionStart ?? []).includes('claude-guard.mjs session-start')) problems.push('the session-start hook is missing');
  const deny = (s.permissions?.deny ?? []).join('\n');
  for (const needle of ['gh pr merge', 'work approve', 'work attest', 'supabase link']) if (!deny.includes(needle)) problems.push(`no permission rule denies "${needle}"`);
  return problems;
}

function ciProblems(root) {
  const file = join(root, '.github/workflows/ci.yml');
  if (!existsSync(file)) return ['.github/workflows/ci.yml is missing'];
  const text = readFileSync(file, 'utf8');
  const problems = [];
  if (!/^ {2}gate:\s*$/m.test(text)) problems.push('there is no job named gate');
  if (!/needs: \[hygiene, records, tests, audit\]/.test(text)) problems.push('the gate does not depend on every sub-job');
  if (/continue-on-error/.test(text)) problems.push('continue-on-error can hide a failure');
  return problems;
}

export function auditRepo({ root = ROOT } = {}) {
  const results = [];
  let groups;
  try {
    groups = loadGroups(join(root, 'tests/groups.json'));
    results.push(check('the test groups file is valid', validateGroups(groups, root)));
  } catch (e) {
    results.push(fail('the test groups file is valid', e.message));
    groups = { groups: {} };
  }

  const tracked = git(root, ['ls-files']).out.split('\n').filter(Boolean);
  const unmapped = checkStrict(tracked, groups, loadExemptions(join(root, 'tests/gate-exemptions.json')), { onlyUnmapped: true }).errors;
  results.push(check('every tracked file is mapped to a test group or an approved exemption', unmapped.map((e) => e.split(':')[0])));

  const bl = loadBacklog(root);
  results.push(check('the backlog is valid', validateBacklog(bl)));

  const problems = [];
  for (const rel of WORKFLOW_FILES) {
    if (!existsSync(join(root, rel))) continue;
    if (git(root, ['check-ignore', '-q', rel]).ok) problems.push(`${rel} is ignored by .gitignore, so it would never be committed`);
  }
  for (const [id, item] of bl.items) {
    const rel = `backlog/items/${item.file}`;
    if (git(root, ['check-ignore', '-q', rel]).ok) problems.push(`${rel} (${id}) is ignored by .gitignore, so it would never be committed`);
  }
  results.push(check('workflow files are not ignored by Git', problems));

  const untracked = ['CLAUDE.md', '.claude/settings.json', 'tests/groups.json', 'backlog/rules.json']
    .filter((rel) => existsSync(join(root, rel)) && !git(root, ['ls-files', '--error-unmatch', rel]).ok)
    .map((rel) => `${rel} exists but is not tracked`);
  results.push(check('the workflow files are tracked', untracked));

  results.push(check('the Claude Code guard is wired in .claude/settings.json', settingsProblems(root)));
  results.push(check('CI has the required gate job', ciProblems(root)));

  const noBypass = [];
  if (existsSync(join(root, 'scripts/hooks/bypass.mjs'))) noBypass.push('scripts/hooks/bypass.mjs exists');
  for (const rel of ['scripts/hooks/lib.mjs', 'scripts/hooks/pre-commit.mjs', 'scripts/hooks/commit-msg.mjs', 'scripts/hooks/pre-push.mjs', 'scripts/install-hooks.sh', '.githooks/pre-commit', '.githooks/commit-msg', '.githooks/pre-push']) {
    if (existsSync(join(root, rel)) && /SKIP_HOOKS/.test(readFileSync(join(root, rel), 'utf8'))) noBypass.push(`${rel} mentions a bypass variable`);
  }
  results.push(check('the hooks have no bypass switch', noBypass));
  return results;
}

export function auditLocal({ root = ROOT } = {}) {
  const results = [];
  const hooksPath = git(root, ['config', '--local', '--get', 'core.hooksPath']).out;
  results.push(hooksPath === '.githooks' ? pass('Git hooks are installed in this clone (core.hooksPath = .githooks)') : fail('Git hooks are installed in this clone (core.hooksPath = .githooks)', `core.hooksPath is "${hooksPath || 'unset'}"; run pnpm hooks:install`));
  for (const hook of ['pre-commit', 'commit-msg', 'pre-push']) {
    const file = join(root, '.githooks', hook);
    let ok = false;
    try {
      ok = existsSync(file) && (statSync(file).mode & 0o111) !== 0;
    } catch {
      ok = false;
    }
    results.push(ok ? pass(`Git hook ${hook} exists and is executable`) : fail(`Git hook ${hook} exists and is executable`, `${file} is missing or not executable`));
  }
  return results;
}

const GATE_RULES = ['pull_request', 'required_status_checks', 'required_linear_history', 'non_fast_forward', 'deletion'];

function covers(ruleset, branch) {
  const ref = ruleset.conditions?.ref_name;
  if (!ref) return false;
  const includes = (ref.include ?? []).some((r) => r === `refs/heads/${branch}` || r === '~ALL' || (r === '~DEFAULT_BRANCH' && branch === 'main'));
  const excluded = (ref.exclude ?? []).some((r) => r === `refs/heads/${branch}`);
  return includes && !excluded;
}

const ruleLabel = {
  pull_request: 'a pull request is required',
  required_status_checks: 'the gate is a required check',
  required_linear_history: 'history must stay linear',
  non_fast_forward: 'force pushes are refused',
  deletion: 'deleting the branch is refused',
};

export function auditRemote({ gh }) {
  const results = [];
  let entries;
  try {
    entries = gh('repos/{owner}/{repo}/rulesets');
  } catch (e) {
    return [fail('GitHub rulesets can be read (gh authenticated)', e.message)];
  }
  const details = [];
  for (const entry of entries) {
    try {
      details.push({ entry, rs: gh(`repos/{owner}/{repo}/rulesets/${entry.id}`) });
    } catch (e) {
      results.push(fail(`ruleset ${entry.id} can be read`, e.message));
    }
  }
  for (const branch of ['develop', 'main']) {
    const covering = details.filter(({ rs }) => covers(rs, branch));
    results.push(covering.length ? pass(`a ruleset covers ${branch}`) : fail(`a ruleset covers ${branch}`, `no ruleset includes refs/heads/${branch}; import docs/process/ruleset-gate.json`));
    const active = covering.filter(({ entry }) => entry.enforcement === 'active');
    results.push(active.length ? pass(`a ruleset covering ${branch} is active`) : fail(`a ruleset covering ${branch} is active`, 'no covering ruleset has enforcement "active"'));
    for (const type of GATE_RULES) {
      const providers = active.filter(({ rs }) =>
        (rs.rules ?? []).some((r) => r.type === type && (type !== 'required_status_checks' || (r.parameters?.required_status_checks ?? []).some((c) => c.context === 'gate'))),
      );
      if (providers.length === 0) {
        results.push(fail(`${branch}: ${ruleLabel[type]}`, type === 'required_status_checks' ? 'the gate is not a required check' : 'no active ruleset provides this rule'));
        continue;
      }
      results.push(pass(`${branch}: ${ruleLabel[type]}`));
      const unbypassable = providers.some(({ rs }) => (rs.bypass_actors ?? []).length === 0);
      results.push(unbypassable ? pass(`${branch}: ${ruleLabel[type]} and cannot be bypassed`) : fail(`${branch}: ${ruleLabel[type]} and cannot be bypassed`, 'every ruleset providing it lists bypass actors (administrators can skip it)'));
    }
  }
  try {
    const env = gh('repos/{owner}/{repo}/environments/Database%20Production');
    const reviewers = (env.protection_rules ?? []).filter((r) => r.type === 'required_reviewers').flatMap((r) => r.reviewers ?? []);
    results.push(reviewers.length ? pass('the Database Production environment requires a reviewer') : fail('the Database Production environment requires a reviewer', 'no required reviewer is set'));
  } catch (e) {
    results.push(fail('the Database Production environment requires a reviewer', e.message));
  }
  return results;
}

function realGh(path) {
  const r = spawnSync('gh', ['api', path], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || 'gh api failed').trim().split('\n')[0]);
  return JSON.parse(r.stdout);
}

export function runAudit(argv, { root = ROOT, gh = realGh, out = console.log } = {}) {
  const wanted = argv.filter((a) => ['--repo', '--local', '--remote'].includes(a));
  const all = wanted.length === 0;
  const results = [
    ...(all || wanted.includes('--repo') ? auditRepo({ root }) : []),
    ...(all || wanted.includes('--local') ? auditLocal({ root }) : []),
    ...(all || wanted.includes('--remote') ? auditRemote({ gh }) : []),
  ];
  for (const r of results) out(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.detail}`}`);
  const failed = results.filter((r) => !r.ok).length;
  out(failed === 0 ? `\nAudit passed (${results.length} checks).` : `\nAudit FAILED: ${failed} of ${results.length} checks.`);
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(runAudit(process.argv.slice(2), { root: process.env.WORK_ROOT || ROOT }));

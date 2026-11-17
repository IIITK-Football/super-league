// Group: tooling. Git hygiene shared by the commit-msg hook, the pre-push hook and CI (scripts/hooks/hygiene.mjs):
// the same code judges a commit range everywhere, so the three cannot disagree.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
// @ts-ignore plain ESM
import { checkPushRefs, checkRange } from '../../../scripts/hooks/hygiene.mjs';
// @ts-ignore plain ESM
import { validateCommitMessage } from '../../../scripts/hooks/lib.mjs';

const root = join(__dirname, '../../..');
let repo: string;
const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();

function commit(file: string, content: string, message: string) {
  mkdirSync(join(repo, file, '..'), { recursive: true });
  writeFileSync(join(repo, file), content);
  git('add', file);
  git('-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'hygiene-'));
  git('init', '-q', '-b', 'develop');
  git('config', 'user.email', 'test@example.test');
  git('config', 'user.name', 'Test');
  commit('base.txt', 'base\n', 'chore: start');
});

describe('validateCommitMessage strict mode (what may be published)', () => {
  it('rejects fixup, squash, amend and WIP commits, which must be tidied before publishing', () => {
    for (const m of ['fixup! feat(a): b', 'squash! feat(a): b', 'amend! feat(a): b', 'WIP: half done', 'wip: half done']) {
      expect(validateCommitMessage(m, { strict: true }).ok, m).toBe(false);
    }
  });

  it('still allows them locally, for rebasing', () => {
    expect(validateCommitMessage('fixup! feat(a): b').ok).toBe(true);
  });
});

describe('checkRange', () => {
  it('passes clean conventional commits', () => {
    const base = git('rev-parse', 'HEAD');
    commit('a.txt', 'a\n', 'feat(core): add a thing');
    commit('b.txt', 'b\n', 'fix(core): repair it\n\nPlain-language body.');
    expect(checkRange(base, 'HEAD', { cwd: repo })).toEqual([]);
  });

  it('rejects a commit message that is not Conventional Commits', () => {
    const base = git('rev-parse', 'HEAD');
    commit('a.txt', 'a\n', 'did some stuff');
    expect(checkRange(base, 'HEAD', { cwd: repo }).join('\n')).toMatch(/Conventional Commits/);
  });

  it('rejects backlog references in the message', () => {
    const base = git('rev-parse', 'HEAD');
    commit('a.txt', 'a\n', 'feat(core): finish SL-044');
    expect(checkRange(base, 'HEAD', { cwd: repo }).join('\n')).toMatch(/backlog references/i);
  });

  it('rejects fixup and WIP commits', () => {
    const base = git('rev-parse', 'HEAD');
    commit('a.txt', 'a\n', 'fixup! chore: start');
    commit('b.txt', 'b\n', 'wip: more');
    expect(checkRange(base, 'HEAD', { cwd: repo }).length).toBeGreaterThanOrEqual(2);
  });

  it('rejects merge commits (history must stay linear)', () => {
    const base = git('rev-parse', 'HEAD');
    git('checkout', '-q', '-b', 'side');
    commit('s.txt', 's\n', 'feat(core): side work');
    git('checkout', '-q', 'develop');
    commit('d.txt', 'd\n', 'feat(core): main work');
    git('-c', 'core.hooksPath=/dev/null', 'merge', '--no-ff', '-q', 'side', '-m', 'Merge branch side');
    expect(checkRange(base, 'HEAD', { cwd: repo }).join('\n')).toMatch(/merge commit/i);
  });

  it('rejects environment and key files', () => {
    const base = git('rev-parse', 'HEAD');
    commit('backend/.env', 'X=1\n', 'feat(core): add config');
    commit('deploy.pem', 'x\n', 'feat(core): add key');
    const out = checkRange(base, 'HEAD', { cwd: repo }).join('\n');
    expect(out).toMatch(/environment files/);
    expect(out).toMatch(/private key or credential/);
  });

  it('rejects a secret-looking value in added lines without echoing it', () => {
    const base = git('rev-parse', 'HEAD');
    const secret = `sb_secret_${'a1b2c3d4e5f6'.repeat(3)}`;
    commit('src.ts', `const k = '${secret}';\n`, 'feat(core): add client');
    const out = checkRange(base, 'HEAD', { cwd: repo }).join('\n');
    expect(out).toMatch(/Supabase secret key/);
    expect(out).not.toContain(secret);
  });

  it('is empty for an empty range', () => {
    expect(checkRange('HEAD', 'HEAD', { cwd: repo })).toEqual([]);
  });
});

describe('checkPushRefs', () => {
  const Z = '0'.repeat(40);
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);

  it('allows pushing develop (the working branch) and any other branch', () => {
    expect(checkPushRefs([`refs/heads/develop ${A} refs/heads/develop ${B}`])).toEqual([]);
    expect(checkPushRefs([`refs/heads/develop ${A} refs/heads/topic-branch ${Z}`])).toEqual([]);
    expect(checkPushRefs([`refs/heads/foo ${A} refs/heads/foo ${Z}`])).toEqual([]);
  });

  it('rejects a direct push to main, pointing at the pull request route', () => {
    const out = checkPushRefs([`refs/heads/develop ${A} refs/heads/main ${B}`]).join('\n');
    expect(out).toMatch(/main/);
    expect(out).toMatch(/pull request/i);
  });

  it('rejects deleting any remote branch', () => {
    expect(checkPushRefs([`(delete) ${Z} refs/heads/topic-branch ${A}`]).join('\n')).toMatch(/delet/i);
  });
});

describe('hook wiring', () => {
  it('has no bypass module and ignores SKIP_HOOKS entirely', () => {
    expect(existsSync(join(root, 'scripts/hooks/bypass.mjs'))).toBe(false);
    const msg = join(mkdtempSync(join(tmpdir(), 'msg-')), 'MSG');
    writeFileSync(msg, 'not a conventional message\n');
    const r = spawnSync('node', [join(root, 'scripts/hooks/commit-msg.mjs'), msg], { encoding: 'utf8', env: { ...process.env, SKIP_HOOKS: 'because I said so' } });
    expect(r.status).toBe(1);
  });

  it('has a pre-push wrapper that only delegates', () => {
    const wrapper = join(root, '.githooks/pre-push');
    expect(existsSync(wrapper)).toBe(true);
  });
});

describe('automatic hook installation (pnpm install runs `prepare`)', () => {
  const installer = join(root, 'scripts/install-hooks.sh');
  const run = (cwd: string, ...args: string[]) => spawnSync('bash', [installer, ...args], { cwd, encoding: 'utf8' });
  const config = (cwd: string, key: string) => spawnSync('git', ['config', '--local', '--get', key], { cwd, encoding: 'utf8' }).stdout.trim();
  const freshRepo = (withHooks = true) => {
    const d = mkdtempSync(join(tmpdir(), 'install-'));
    spawnSync('git', ['init', '-q'], { cwd: d });
    if (withHooks) mkdirSync(join(d, '.githooks'));
    return d;
  };

  it('root package.json runs it on install', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts.prepare).toMatch(/install-hooks\.sh --auto/);
  });

  it('--auto points core.hooksPath at .githooks without asking', () => {
    const d = freshRepo();
    expect(run(d, '--auto').status).toBe(0);
    expect(config(d, 'core.hooksPath')).toBe('.githooks');
  });

  it('--auto leaves a different hooks path alone, warns, and still succeeds (an install must never fail)', () => {
    const d = freshRepo();
    spawnSync('git', ['config', '--local', 'core.hooksPath', '.husky'], { cwd: d });
    const r = run(d, '--auto');
    expect(r.status).toBe(0);
    expect(r.stderr + r.stdout).toMatch(/not overriding/i);
    expect(config(d, 'core.hooksPath')).toBe('.husky');
  });

  it('--auto succeeds quietly outside a git repository and when .githooks is absent', () => {
    expect(run(mkdtempSync(join(tmpdir(), 'nogit-')), '--auto').status).toBe(0);
    expect(run(freshRepo(false), '--auto').status).toBe(0);
  });

  it('never mentions a bypass variable', () => {
    expect(readFileSync(installer, 'utf8')).not.toMatch(/SKIP_HOOKS/);
  });
});

describe('everyday commits and pushes stay fast (rigid validation happens at phase completion)', () => {
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

  it('pre-commit only runs the fast staged-file safety checks, never a test group', () => {
    const src = read('scripts/hooks/pre-commit.mjs');
    expect(src).not.toMatch(/test-groups/);
    expect(src).toMatch(/checkStagedFiles/);
    expect(src).toMatch(/scanAddedLines/);
  });

  it('pre-push checks hygiene and the push target only, never a test group', () => {
    const src = read('scripts/hooks/pre-push.mjs');
    expect(src).not.toMatch(/test-groups/);
    expect(src).toMatch(/checkRange/);
    expect(src).toMatch(/checkPushRefs/);
  });

  it('pre-push judges only what came after the workflow was adopted, exactly as CI does (older history cannot be rewritten)', () => {
    const src = read('scripts/hooks/pre-push.mjs');
    expect(src).toMatch(/rangeBase/);
    expect(src).toMatch(/range-base\.mjs/);
  });
});

describe('no AI attribution in commits (the repository history shows the owner as the only author)', () => {
  const trailer = (t: string) => `feat(core): add a thing\n\nA plain-language body.\n\n${t}`;

  it('the commit-msg check rejects an AI co-author trailer in any wording', () => {
    for (const t of [
      'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>',
      'Co-authored-by: Claude <noreply@anthropic.com>',
      'Co-Authored-By: Some Assistant <bot@anthropic.com>',
      'co-authored-by: Anthropic Claude Opus <x@example.com>',
    ]) {
      const r = validateCommitMessage(trailer(t));
      expect(r.ok, t).toBe(false);
      expect(r.errors.join(' '), t).toMatch(/attribution/i);
    }
  });

  it('rejects a generated-with line', () => {
    const r = validateCommitMessage(trailer('Generated with [Claude Code](https://claude.com/claude-code)'));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/attribution/i);
  });

  it('does not reject a message that merely mentions the tool or a human co-author', () => {
    expect(validateCommitMessage('feat(tooling): add a Claude Code guard for the gates').ok).toBe(true);
    expect(validateCommitMessage(trailer('Co-Authored-By: Jane Roe <jane@example.com>')).ok).toBe(true);
    expect(validateCommitMessage('docs(process): explain why CLAUDE.md is tracked').ok).toBe(true);
  });

  it('the same rule applies to every commit in a range (CI)', () => {
    const base = git('rev-parse', 'HEAD');
    commit('a.txt', 'a\n', trailer('Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>'));
    expect(checkRange(base, 'HEAD', { cwd: repo }).join('\n')).toMatch(/attribution/i);
  });

  it('rejects a commit whose author or committer is an AI identity', () => {
    const base = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, 'b.txt'), 'b\n');
    git('add', 'b.txt');
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'feat(core): by an assistant', '--author', 'Claude <noreply@anthropic.com>');
    expect(checkRange(base, 'HEAD', { cwd: repo }).join('\n')).toMatch(/AI author/i);

    const base2 = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, 'c.txt'), 'c\n');
    git('add', 'c.txt');
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'feat(core): committed by an assistant'], {
      cwd: repo,
      env: { ...process.env, GIT_COMMITTER_NAME: 'Claude', GIT_COMMITTER_EMAIL: 'noreply@anthropic.com' },
    });
    expect(checkRange(base2, 'HEAD', { cwd: repo }).join('\n')).toMatch(/AI committer/i);
  });

  it('an ordinary human author and committer pass', () => {
    const base = git('rev-parse', 'HEAD');
    commit('d.txt', 'd\n', 'feat(core): ordinary');
    expect(checkRange(base, 'HEAD', { cwd: repo })).toEqual([]);
  });
});

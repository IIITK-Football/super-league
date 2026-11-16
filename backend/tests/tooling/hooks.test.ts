// Group: tooling. Commit-time helper (scripts/hooks).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkStagedFiles, scanAddedLines, validateCommitMessage } from '../../../scripts/hooks/lib.mjs';

const root = join(__dirname, '../../..');

describe('validateCommitMessage', () => {
  it('accepts readable conventional messages', () => {
    expect(validateCommitMessage('feat(db): add deterministic local seed data\n\nbody').ok).toBe(true);
    expect(validateCommitMessage('fix: handle empty roster').ok).toBe(true);
    expect(validateCommitMessage('chore(repo)!: drop npm lockfiles').ok).toBe(true);
  });

  it('rejects non-conventional messages with an actionable hint', () => {
    const r = validateCommitMessage('updated stuff');
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/type\(scope\): subject/);
    expect(r.errors.join(' ')).toMatch(/feat, fix, docs/);
  });

  it('rejects unknown types, empty subjects and overlong first lines', () => {
    expect(validateCommitMessage('wip: thing').ok).toBe(false);
    expect(validateCommitMessage('feat: ').ok).toBe(false);
    expect(validateCommitMessage(`feat: ${'x'.repeat(80)}`).ok).toBe(false);
  });

  it('ignores comments and allows merge/revert/fixup commits', () => {
    expect(validateCommitMessage('# comment only\nfeat: add thing\n# more').ok).toBe(true);
    expect(validateCommitMessage('Merge branch develop').ok).toBe(true);
    expect(validateCommitMessage('fixup! feat: add thing').ok).toBe(true);
  });

  it('does not ask for a backlog id', () => {
    const r = validateCommitMessage('feat(ui): add thing');
    expect(r.ok).toBe(true);
    expect(r.hints).toEqual([]);
  });

  it('rejects backlog references anywhere in the message', () => {
    for (const m of [
      'feat(db): SL-011 deterministic local seed',
      'feat(db): add seed\n\nImplements SL-011.',
      'feat(db): add seed\n\nBacklog item: SL-011',
      'feat(db): add seed\n\nBacklog item 11',
      'feat(db): add seed\n\nRefs: sl-012',
    ]) {
      const r = validateCommitMessage(m);
      expect(r.ok, m).toBe(false);
      expect(r.errors.join(' ')).toMatch(/backlog/i);
    }
  });

  it('still allows the word backlog in ordinary sentences', () => {
    expect(validateCommitMessage('fix(api): clear the retry backlog after a timeout').ok).toBe(true);
  });
});

describe('checkStagedFiles', () => {
  it('blocks env files other than examples', () => {
    expect(checkStagedFiles(['backend/.env.local', 'frontend/.env', 'a/.env.production'])).toHaveLength(3);
    expect(checkStagedFiles(['backend/.env.example', 'src/env.js'])).toEqual([]);
  });

  it('blocks key and credential files', () => {
    expect(checkStagedFiles(['certs/server.pem', 'id_rsa']).length).toBe(2);
  });
});

describe('scanAddedLines', () => {
  const diff = (line: string) => `diff --git a/x.js b/x.js\n+++ b/x.js\n@@ -0,0 +1 @@\n+${line}\n`;

  it('flags secret-looking additions without echoing the value', () => {
    const secret = 'sb_secret_' + 'A'.repeat(24);
    const f = scanAddedLines(diff(`const k = '${secret}'`));
    expect(f).toHaveLength(1);
    expect(JSON.stringify(f)).not.toContain(secret);
    expect(f[0].file).toBe('x.js');
    expect(scanAddedLines(diff('-----BEGIN ' + 'PRIVATE KEY-----'))).toHaveLength(1);
    expect(scanAddedLines(diff('const j = "eyJ' + 'a'.repeat(30) + '.' + 'b'.repeat(30) + '"'))).toHaveLength(1);
  });

  it('ignores ordinary code and removed lines', () => {
    expect(scanAddedLines(diff('const x = 1;'))).toEqual([]);
    expect(scanAddedLines('--- a/x\n-const k = "sb_secret_' + 'A'.repeat(24) + '"\n')).toEqual([]);
  });
});

describe('commit-msg hook (executable)', () => {
  const run = (msg: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'hook-'));
    const file = join(dir, 'MSG');
    writeFileSync(file, msg);
    return spawnSync('node', [join(root, 'scripts/hooks/commit-msg.mjs'), file], { encoding: 'utf8' });
  };
  it('exits 0 for valid and 1 for invalid, without modifying the message', () => {
    expect(run('feat(x): ok').status).toBe(0);
    const bad = run('nope');
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/Conventional/i);
  });
});

describe('escape hatch', () => {
  it('logs a bypass with its reason and exits 0 without running checks', () => {
    const repo = mkdtempSync(join(tmpdir(), 'repo-'));
    spawnSync('git', ['init', '-q'], { cwd: repo });
    const r = spawnSync('node', [join(root, 'scripts/hooks/pre-commit.mjs')], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, SKIP_HOOKS: 'production outage hotfix' },
    });
    expect(r.status).toBe(0);
    const log = join(repo, '.git', 'hooks-bypass.log');
    expect(existsSync(log)).toBe(true);
    expect(readFileSync(log, 'utf8')).toMatch(/pre-commit.*production outage hotfix/);
  });
});

describe('wiring', () => {
  it('hook wrappers exist and only delegate; they never commit or add files', () => {
    for (const h of ['pre-commit', 'commit-msg']) {
      const src = readFileSync(join(root, '.githooks', h), 'utf8');
      expect(src).toMatch(/scripts\/hooks\//);
      expect(src).not.toMatch(/git (add|commit|checkout|reset|stash)/);
    }
  });
});

// Group: tooling. scripts/work/range-base.mjs: the gate for main judges what came AFTER the workflow was adopted, not the
// history before it (which cannot be rewritten). The adoption point is a tracked file; the base for a range is whichever
// of "the target branch" and "the adoption commit" is more recent.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
// @ts-ignore plain ESM
import { rangeBase } from '../../../scripts/work/range-base.mjs';

const real = join(__dirname, '../../..');
let root: string;
const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const commit = (name: string) => {
  writeFileSync(join(root, name), `${name}\n`);
  git('add', '-A');
  git('-c', 'user.email=t@t.test', '-c', 'user.name=T', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', `chore: ${name}`);
  return git('rev-parse', 'HEAD');
};
const adopt = (sha: string) => {
  mkdirSync(join(root, 'tests'), { recursive: true });
  writeFileSync(join(root, 'tests/gate-baseline.json'), JSON.stringify({ adoptedAt: sha, note: 'test' }));
};

let a: string;
let b: string;
let c: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'range-base-'));
  git('init', '-q', '-b', 'develop');
  a = commit('a'); // old history, and where main is
  b = commit('b'); // the workflow was adopted here
  c = commit('c');
});

describe('rangeBase', () => {
  it('starts at the adoption commit when the target branch is older, so earlier history is not judged', () => {
    adopt(b);
    expect(rangeBase(a, { root })).toBe(b);
  });

  it('starts at the target branch once it already contains the adoption commit', () => {
    adopt(b);
    expect(rangeBase(c, { root })).toBe(c);
    expect(rangeBase(b, { root })).toBe(b);
  });

  it('uses the target branch when there is no baseline file', () => {
    expect(rangeBase(a, { root })).toBe(a);
  });

  it('ignores a baseline that is not part of this history, instead of silently judging nothing', () => {
    adopt('0'.repeat(40));
    expect(rangeBase(a, { root })).toBe(a);
  });

  it('fails clearly for a target that does not exist', () => {
    expect(() => rangeBase('no-such-ref', { root })).toThrow(/no-such-ref/);
  });
});

describe('this repository', () => {
  it('has an adoption point that is an ancestor of HEAD', () => {
    const adoptedAt = JSON.parse(readFileSync(join(real, 'tests/gate-baseline.json'), 'utf8')).adoptedAt;
    expect(adoptedAt).toMatch(/^[0-9a-f]{40}$/);
    expect(spawnSync('git', ['merge-base', '--is-ancestor', adoptedAt, 'HEAD'], { cwd: real }).status).toBe(0);
  });
});

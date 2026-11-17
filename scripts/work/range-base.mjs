#!/usr/bin/env node
// The gate for main judges what came AFTER the workflow was adopted (tests/gate-baseline.json), not the history before
// it, which cannot be rewritten. The base of a range is whichever is more recent: the target branch or the adoption commit.
//
//   node scripts/work/range-base.mjs <ref>      prints the commit the range should start from
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './backlog.mjs';

function git(root, args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' });
}

export function rangeBase(ref, { root = ROOT } = {}) {
  const resolved = git(root, ['rev-parse', '--verify', `${ref}^{commit}`]);
  if (resolved.status !== 0) throw new Error(`cannot resolve ${ref} to a commit`);
  const refSha = resolved.stdout.trim();
  const file = join(root, 'tests/gate-baseline.json');
  if (!existsSync(file)) return refSha;
  const adoptedAt = JSON.parse(readFileSync(file, 'utf8')).adoptedAt;
  const isAncestor = (a, b) => git(root, ['merge-base', '--is-ancestor', a, b]).status === 0;
  // An adoption commit that is not part of this history is ignored rather than silently judging nothing.
  if (!adoptedAt || !isAncestor(adoptedAt, 'HEAD')) return refSha;
  // Once the target already contains the adoption commit, its own tip is the base.
  if (isAncestor(adoptedAt, refSha)) return refSha;
  return adoptedAt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ref = process.argv[2];
  if (!ref) {
    console.error('usage: node scripts/work/range-base.mjs <ref>');
    process.exit(2);
  }
  try {
    console.log(rangeBase(ref, { root: process.env.WORK_ROOT || ROOT }));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

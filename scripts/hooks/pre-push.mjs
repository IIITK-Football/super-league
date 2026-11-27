#!/usr/bin/env node
// pre-push: work happens directly on develop, so develop may be pushed; only main (reached by pull request) and branch
// deletion are refused, and the outgoing commits must pass Git hygiene (the same code CI uses). Fast: no tests run here; they run at phase completion and in
// CI for pull requests into main. Read-only: never stages, edits or commits anything.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { checkPushRefs, checkRange } from './hygiene.mjs';
import { rangeBase } from '../work/range-base.mjs';

const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim();
const git = (args) => spawnSync('git', args, { cwd: top, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const fail = (lines) => {
  console.error(`pre-push: blocked:\n  - ${lines.join('\n  - ')}`);
  process.exit(1);
};

const lines = readFileSync(0, 'utf8').split('\n').filter(Boolean);
const refProblems = checkPushRefs(lines);
if (refProblems.length) fail(refProblems);

for (const line of lines) {
  const [, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
  // A new branch is judged against develop on the remote; an update against what the remote already has.
  const isNew = /^0+$/.test(remoteSha);
  let start = isNew ? git(['merge-base', localSha, 'origin/develop']).stdout.trim() : remoteSha;
  // Bootstrap a fork only at the exact upstream tip, with the usual hygiene checks still applied.
  if (!start && isNew && process.argv[2] === 'origin' && remoteRef === 'refs/heads/develop') {
    const upstream = git(['rev-parse', '--verify', 'upstream/develop^{commit}']).stdout.trim();
    if (upstream === localSha) start = upstream;
  }
  if (!start) fail(['cannot find where this branch starts (fetch origin first).']);
  // Judge only what came after the workflow was adopted, exactly as CI does: older history cannot be rewritten.
  let base;
  try {
    base = rangeBase(start, { root: top });
  } catch {
    fail([`cannot find ${start.slice(0, 7)} locally (fetch origin first).`]);
  }
  const problems = checkRange(base, localSha, { cwd: top });
  if (problems.length) fail(problems);
}

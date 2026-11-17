#!/usr/bin/env node
// pre-push: only ready/<name> branches may be pushed (develop and main are reached by pull request), and the outgoing
// commits must pass Git hygiene (the same code CI uses). Fast: no tests run here; they run at phase completion and in
// CI for pull requests into main. Read-only: never stages, edits or commits anything.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { checkPushRefs, checkRange } from './hygiene.mjs';

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
  const [, localSha, , remoteSha] = line.trim().split(/\s+/);
  // A new branch is judged against develop on the remote; an update against what the remote already has.
  const isNew = /^0+$/.test(remoteSha);
  const base = isNew ? git(['merge-base', localSha, 'origin/develop']).stdout.trim() : remoteSha;
  if (!base) fail(['cannot find where this branch starts (fetch origin first).']);
  const problems = checkRange(base, localSha, { cwd: top });
  if (problems.length) fail(problems);
}

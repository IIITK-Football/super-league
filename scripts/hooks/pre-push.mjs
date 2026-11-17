#!/usr/bin/env node
// pre-push: the whole outgoing range must pass the same gate CI applies, before anything leaves this machine.
//   1. only ready/<name> branches may be pushed (develop and main are reached by pull request);
//   2. Git hygiene over every outgoing commit (shared with CI);
//   3. the strict test rules over the whole range, then the test groups that range affects.
// Read-only: never stages, edits or commits anything. There is deliberately no bypass switch.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

const head = git(['rev-parse', 'HEAD']).stdout.trim();
for (const line of lines) {
  const [, localSha, , remoteSha] = line.trim().split(/\s+/);
  if (localSha !== head) fail([`${line.split(/\s+/)[0]} is not the checked-out commit. Check out the branch you are pushing so the tests run against it.`]);
  // A new branch is judged against develop on the remote; an update against what the remote already has.
  const isNew = /^0+$/.test(remoteSha);
  const base = isNew ? git(['merge-base', localSha, 'origin/develop']).stdout.trim() : remoteSha;
  if (!base) fail(['cannot find where this branch starts (fetch origin first).']);

  const problems = checkRange(base, localSha, { cwd: top });
  if (problems.length) fail(problems);

  const strict = spawnSync('node', [join(top, 'scripts/test-groups.mjs'), 'check', '--base', base], { cwd: top, stdio: 'inherit' });
  if (strict.status !== 0) process.exit(1);

  const files = git(['diff', '--name-only', `${base}..${localSha}`]).stdout.split('\n').filter(Boolean);
  if (files.length) {
    const run = spawnSync('node', [join(top, 'scripts/test-groups.mjs'), 'affected', '--files', ...files], { cwd: top, stdio: 'inherit' });
    if (run.status !== 0) {
      console.error('\npre-push: a test group failed. Re-run one with: pnpm test:group <name>. CI applies the same gate and cannot be bypassed.');
      process.exit(1);
    }
  }
}

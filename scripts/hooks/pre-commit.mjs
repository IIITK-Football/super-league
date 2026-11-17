#!/usr/bin/env node
// Pre-commit: fast staged-file safety only (env files, key files, secret-looking additions). It takes well under a
// second. Tests, strict test rules and the other heavy validation run at phase completion (`pnpm work phase`) and in
// CI for pull requests into main, not on every commit. Read-only: never stages, edits, or commits anything.
import { spawnSync } from 'node:child_process';
import { checkStagedFiles, scanAddedLines } from './lib.mjs';

const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim();
const git = (args) => spawnSync('git', args, { cwd: top, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const files = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']).stdout.split('\n').filter(Boolean);
if (files.length === 0) process.exit(0);

const problems = checkStagedFiles(files);
for (const f of scanAddedLines(git(['diff', '--cached', '-U0']).stdout)) {
  problems.push(`${f.file}:${f.line}: possible ${f.pattern} in added code (value not shown).`);
}
if (problems.length) {
  console.error('pre-commit: staged changes blocked:\n  - ' + problems.join('\n  - '));
  console.error('\nFix by unstaging/removing the item (git restore --staged <file>).');
  process.exit(1);
}

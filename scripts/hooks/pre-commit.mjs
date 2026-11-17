#!/usr/bin/env node
// Pre-commit: staged-file safety checks, then the test groups affected by the staged paths.
// Read-only: never stages, edits, or commits anything.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
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

const run = spawnSync('node', [join(top, 'scripts/test-groups.mjs'), 'affected', '--staged', '--strict', '--commit-stage'], { cwd: top, stdio: 'inherit' });
if (run.status !== 0) {
  console.error('\npre-commit: a test group failed. Re-run one with: pnpm test:group <name>. ' +
    'CI applies the same gate.');
  process.exit(1);
}

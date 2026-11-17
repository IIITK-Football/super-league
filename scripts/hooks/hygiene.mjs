// Git hygiene for a range of commits and for push targets. Shared by the pre-push hook and CI so the two judge
// identically. Read-only: it never edits, stages or commits anything.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkStagedFiles, scanAddedLines, validateCommitMessage } from './lib.mjs';

const ZERO = /^0+$/;

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

// Returns a list of problems (empty = clean) for the commits in base..head.
export function checkRange(base, head, { cwd = process.cwd() } = {}) {
  const problems = [];
  const shas = git(['rev-list', '--reverse', `${base}..${head}`], cwd).split('\n').filter(Boolean);
  for (const sha of shas) {
    const short = sha.slice(0, 7);
    const parents = git(['rev-list', '--parents', '-n', '1', sha], cwd).trim().split(' ').length - 1;
    if (parents > 1) problems.push(`${short}: merge commit. Keep history linear: rebase instead of merging.`);
    const message = git(['log', '-1', '--format=%B', sha], cwd);
    const result = validateCommitMessage(message, { strict: true });
    for (const e of result.errors) problems.push(`${short}: ${e}`);
    const files = git(['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', '--diff-filter=ACMR', sha], cwd).split('\n').filter(Boolean);
    for (const p of checkStagedFiles(files)) problems.push(`${short}: ${p}`);
    for (const f of scanAddedLines(git(['show', '-U0', '--format=', sha], cwd))) {
      problems.push(`${short}: ${f.file}:${f.line}: possible ${f.pattern} in added code (value not shown).`);
    }
  }
  return problems;
}

// Lines come from Git's pre-push hook: "<local ref> <local sha> <remote ref> <remote sha>".
// Everything is published through a ready/<name> branch and a pull request, so the same required checks judge it.
export function checkPushRefs(lines) {
  const problems = [];
  for (const line of lines) {
    const [localRef, localSha, remoteRef] = line.trim().split(/\s+/);
    if (!remoteRef) continue;
    if (localRef === '(delete)' || ZERO.test(localSha ?? '')) {
      problems.push(`${remoteRef}: deleting remote branches is not done from here.`);
    } else if (!/^refs\/heads\/ready\/[A-Za-z0-9._-]+$/.test(remoteRef)) {
      problems.push(
        `${remoteRef}: not allowed. Changes reach develop and main by pull request. Push a branch named ready/<short-name> and open a pull request; the required "gate" check judges it.`,
      );
    }
  }
  return problems;
}

// Command line, used by CI: node scripts/hooks/hygiene.mjs <base> <head>
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [base, head] = process.argv.slice(2);
  if (!base || !head) {
    console.error('usage: node scripts/hooks/hygiene.mjs <base> <head>');
    process.exit(2);
  }
  const problems = checkRange(base, head);
  if (problems.length) {
    console.error(`Git hygiene failed (${problems.length}):\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`Git hygiene passed for ${base}..${head}`);
}

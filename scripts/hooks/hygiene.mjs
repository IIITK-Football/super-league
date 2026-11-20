// Git hygiene for a range of commits and for push targets. Shared by the pre-push hook and CI so the two judge
// identically. Read-only: it never edits, stages or commits anything.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_NAME, checkStagedFiles, scanAddedLines, validateCommitMessage } from './lib.mjs';

const ZERO = /^0+$/;

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

const quiet = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' }).status === 0;
const isAncestor = (a, b, cwd) => quiet(['merge-base', '--is-ancestor', a, b], cwd);

// Returns a list of problems (empty = clean) for the commits in base..head.
//
// History stays linear, with one exception the main ruleset requires: main only accepts a pull request whose branch is
// up to date with main, so develop must take in main's release merges. When the main ref exists (origin/main by
// default; CI fetches full history):
// - commits already on main are not judged again (they passed main's gate);
// - a merge commit is allowed only if every parent it brings in is already on main, i.e. it merges main into the
//   branch. Every other merge is still refused.
export function checkRange(base, head, { cwd = process.cwd(), mainRef = 'origin/main' } = {}) {
  const problems = [];
  const main = mainRef && quiet(['rev-parse', '--verify', '--quiet', `${mainRef}^{commit}`], cwd) ? mainRef : null;
  const shas = git(['rev-list', '--reverse', `${base}..${head}`], cwd).split('\n').filter(Boolean);
  for (const sha of shas) {
    const short = sha.slice(0, 7);
    if (main && isAncestor(sha, main, cwd)) continue;
    const parentShas = git(['rev-list', '--parents', '-n', '1', sha], cwd).trim().split(' ').slice(1);
    if (parentShas.length > 1) {
      const fromMain = main && parentShas.slice(1).every((p) => isAncestor(p, main, cwd));
      if (!fromMain) problems.push(`${short}: merge commit. Keep history linear: rebase instead of merging (only merging main into the branch is allowed).`);
    }
    const [an, ae, cn, ce] = git(['log', '-1', '--format=%an%n%ae%n%cn%n%ce', sha], cwd).split('\n');
    if (AI_NAME.test(`${an} ${ae}`)) problems.push(`${short}: AI author identity. Commits are authored by the owner only.`);
    if (AI_NAME.test(`${cn} ${ce}`)) problems.push(`${short}: AI committer identity. Commits are committed by the owner only.`);
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
// Work happens directly on develop, so pushing develop (or any other branch) is fine. Only two things are refused:
// a direct push to main (the production branch is reached by pull request, which runs the phase-completion gate)
// and deleting a remote branch.
export function checkPushRefs(lines) {
  const problems = [];
  for (const line of lines) {
    const [localRef, localSha, remoteRef] = line.trim().split(/\s+/);
    if (!remoteRef) continue;
    if (localRef === '(delete)' || ZERO.test(localSha ?? '')) {
      problems.push(`${remoteRef}: deleting remote branches is not done from here.`);
    } else if (remoteRef === 'refs/heads/main') {
      problems.push('refs/heads/main: main is reached by pull request, which runs the full phase-completion gate. Push develop and open a pull request into main.');
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

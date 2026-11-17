#!/usr/bin/env node
// Claude Code guard, run before every Bash, Edit and Write tool call (wired in .claude/settings.json) and at session start.
//
//   claude-guard.mjs pre-tool        reads the tool call as JSON on stdin; exit 2 = blocked (reason on stderr);
//                                    prints a permissionDecision "ask" so the OWNER confirms; silent exit 0 = allowed
//   claude-guard.mjs session-start   prints workflow facts as additional context
//
// It is deterministic. It enforces, with no agent discretion: no bypass of the hooks, no unsafe Git, the owner-only
// workflow steps (approve, attest), no GitHub settings changes, and the safety boundaries from CLAUDE.md. CI is still the
// authority; this stops an attempt before it happens and says why. Decisions: allow | ask | deny.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const allow = { decision: 'allow' };
const deny = (reason) => ({ decision: 'deny', reason });
const ask = (reason) => ({ decision: 'ask', reason });

// Replaces the inside of quoted strings so flags are only read where they are real flags.
const strip = (s) => s.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
const splitSegments = (s) => s.split(/&&|\|\||[;|\n]|\$\(|`|\(|\)/).map((x) => x.trim()).filter(Boolean);
const PREFIXES = /^(?:(?:sudo|command|time|nohup|exec|builtin)\s+|[A-Za-z_][A-Za-z0-9_]*=\S*\s+|env\s+(?=[A-Za-z_]\w*=))+/;
const norm = (seg) => seg.replace(PREFIXES, '').trim();

// A command is judged by what it WRITES to and what CODE it runs, not by words that merely appear in it (a commit message,
// the data of a heredoc, an echo). `analyze` separates the command text from heredoc bodies and finds inline interpreter code.
const INTERPRETERS = new Set(['python', 'python3', 'node', 'perl', 'ruby', 'bash', 'sh', 'zsh']);
const WRITERS = new Set(['cp', 'mv', 'rm', 'tee', 'install', 'truncate', 'dd', 'ln']);
const RECORDS = /backlog\/(?:approvals|attestations|evidence)\//;
// Only the files that DEFINE the gates need the owner's confirmation to change; everyday scripts, tests and docs are ordinary.
const PROTECTED_PATH = /(?:\.claude\/(?:settings(?:\.local)?\.json|hooks\/)|\.githooks\/|scripts\/work\/claude-guard\.mjs|tests\/gate-exemptions\.json|\.github\/workflows\/ci\.yml)/;

function analyze(command) {
  let lines = command;
  let code = '';
  let nodeCode = '';
  const heredoc = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1[^\n]*\n/;
  for (let guard = 0; guard < 20; guard++) {
    const m = heredoc.exec(lines);
    if (!m) break;
    const consumer = norm(lines.slice(0, m.index).split(/&&|\|\||[;|\n]/).pop().trim()).split(/\s+/)[0] ?? '';
    const bodyStart = m.index + m[0].length;
    const rest = lines.slice(bodyStart);
    const end = new RegExp(`^\\s*${m[2]}\\s*$`, 'm').exec(rest);
    const body = end ? rest.slice(0, end.index) : rest;
    if (INTERPRETERS.has(consumer)) {
      code += `\n${body}`;
      if (consumer === 'node') nodeCode += `\n${body}`;
    }
    lines = lines.slice(0, bodyStart) + (end ? rest.slice(end.index + end[0].length) : '');
  }
  const inline = /\b(python3?|node|perl|ruby)\b[^\n]*?\s(?:-c|-e|--eval|-p)\s+("(?:[^"\\]|\\.)*"|'[^']*')/g;
  for (const m of lines.matchAll(inline)) {
    code += `\n${m[2]}`;
    if (m[1] === 'node') nodeCode += `\n${m[2]}`;
  }
  return { lines, code, nodeCode };
}

const unquote = (t) => t.replace(/^["']|["']$/g, '');

// Every file this command writes to: redirect targets and the arguments of writing commands.
function writeTargets(lines) {
  const targets = [];
  for (const m of lines.matchAll(/(?:^|[^0-9&>])>{1,2}\s*([^\s&|;<>()]+)/g)) {
    const t = unquote(m[1]);
    if (t && t !== '/dev/null') targets.push(t);
  }
  for (const seg of splitSegments(lines)) {
    const tokens = norm(seg).split(/\s+/);
    const head = tokens[0];
    const writes =
      WRITERS.has(head) ||
      (head === 'sed' && tokens.some((t) => /^-[A-Za-z]*i/.test(t) || t === '--in-place')) ||
      (head === 'git' && ['checkout', 'restore', 'apply', 'rm', 'mv'].includes(gitTokens(norm(seg)).sub));
    if (writes) targets.push(...tokens.slice(1).filter((t) => !t.startsWith('-')).map(unquote));
  }
  return targets;
}

const ENFORCEMENT_ASK = 'This file is part of the enforced workflow itself (the gates). Changing it needs the owner\'s explicit confirmation.';

function gitTokens(seg) {
  const t = seg.split(/\s+/);
  let i = 1;
  while (i < t.length && t[i].startsWith('-')) {
    i += t[i] === '-c' || t[i] === '-C' ? 2 : 1;
  }
  return { sub: t[i] ?? '', args: t.slice(i + 1) };
}

const PROTECTED_BRANCH = /^(?:refs\/heads\/)?(?:main|develop)$/;

function judgeGit(seg) {
  const { sub, args } = gitTokens(seg);
  const flags = args.filter((a) => a.startsWith('-'));
  const plain = args.filter((a) => !a.startsWith('-'));
  const has = (...names) => flags.some((f) => names.includes(f));
  if (['commit', 'push', 'merge', 'rebase', 'cherry-pick', 'am'].includes(sub) && has('--no-verify')) {
    return deny('Skipping the Git hooks (--no-verify) is not allowed. The checks run again in CI and cannot be skipped there.');
  }
  if (sub === 'commit' && flags.some((f) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(f))) {
    return deny('git commit -n is --no-verify: skipping the Git hooks is not allowed.');
  }
  if (sub === 'push') {
    if (has('--force', '-f', '--delete', '-d', '--mirror', '--prune') || flags.some((f) => f.startsWith('--force-with-lease'))) {
      return deny('Force pushes and remote deletions are not done from here.');
    }
    for (const a of plain.slice(1)) {
      const dst = a.includes(':') ? a.split(':')[1] : a;
      if (a.startsWith(':') || a.startsWith('+')) return deny('Deleting or force-pushing a ref is not done from here.');
      if (PROTECTED_BRANCH.test(dst)) return deny('develop and main are reached by pull request: push a ready/<name> branch and open a pull request.');
    }
  }
  if (sub === 'reset' && has('--hard')) return deny('git reset --hard would discard work. It is not run from here.');
  if (sub === 'clean' && (has('--force') || flags.some((f) => /^-[a-zA-Z]*[fd][a-zA-Z]*$/.test(f)))) return deny('git clean would delete files. It is not run from here.');
  if (sub === 'checkout') {
    if (args.includes('--') || args.includes('.') || has('-f', '--force')) return deny('Restoring files with git checkout would overwrite uncommitted work. It is not run from here.');
    if (plain.some((a) => PROTECTED_BRANCH.test(a) && a === 'main') && !has('-b', '-B')) return deny('Work happens on develop, never on main.');
  }
  if (sub === 'switch' && plain.includes('main') && !has('-c', '-C', '--create')) return deny('Work happens on develop, never on main.');
  if (sub === 'restore') {
    if (!has('--staged', '-S') || has('--worktree', '-W')) return deny('git restore on working files would overwrite uncommitted work. Only `git restore --staged` is allowed.');
  }
  if (sub === 'stash' && ['drop', 'clear'].includes(plain[0])) return deny('Dropping stashes would discard work.');
  if (sub === 'branch' && has('-D')) return deny('Force-deleting a branch is not done from here.');
  if (sub === 'update-ref' || (sub === 'reflog' && ['expire', 'delete'].includes(plain[0])) || (sub === 'gc' && flags.some((f) => f.startsWith('--prune')))) {
    return deny('Rewriting or pruning Git history data is not done from here.');
  }
  return null;
}

// The base branch of the pull request being merged, looked up with a read-only gh call.
function defaultPrBase(seg) {
  const ref = seg.split(/\s+/).slice(3).find((x) => !x.startsWith('-')) ?? '';
  const r = spawnSync('gh', ['pr', 'view', ...(ref ? [ref] : []), '--json', 'baseRefName', '--jq', '.baseRefName'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() || null : null;
}

function judgeGh(seg, ctx) {
  const t = seg.split(/\s+/);
  const sub = t[1] ?? '';
  const sub2 = t[2] ?? '';
  if (sub === 'pr' && sub2 === 'merge') {
    // A green pull request into develop may be merged: the required gate has already judged it. Merging into main starts
    // the production workflow, so that stays the owner's. The gate is never overridden.
    if (/(?:^|\s)--admin\b/.test(seg)) return deny('Merging over a failing or missing gate (--admin) is not allowed.');
    return ctx.prBase(seg) === 'develop' ? null : deny('Merging into main (which starts the production workflow) is the owner\'s decision; only pull requests into develop may be merged from here.');
  }
  if (sub === 'pr' && sub2 === 'review') return deny('Approving or reviewing pull requests is the owner\'s decision.');
  if (sub === 'api') {
    const method = seg.match(/(?:-X\s*|--method[= ]\s*)(\w+)/i);
    if (method && /^(POST|PUT|PATCH|DELETE)$/i.test(method[1])) return deny('Changing GitHub settings through the API is the owner\'s step (read-only gh api calls are fine).');
    if (/(?:^|\s)(?:-f|-F|--field|--raw-field|--input)\b/.test(seg)) return deny('gh api with a body is a write (it implies POST). GitHub settings are the owner\'s step.');
  }
  if ((sub === 'secret' || sub === 'variable') && ['set', 'delete', 'remove'].includes(sub2)) return deny('GitHub secrets and variables are set by the owner.');
  if (sub === 'repo' && ['edit', 'delete', 'archive', 'rename', 'transfer'].includes(sub2)) return deny('Repository settings are the owner\'s step.');
  if (sub === 'ruleset' && !['list', 'view', 'check'].includes(sub2)) return deny('Rulesets are the owner\'s step.');
  if (sub === 'auth' && (['login', 'refresh', 'setup-git', 'logout', 'switch', 'token'].includes(sub2) || (sub2 === 'status' && /(?:^|\s)(?:-t|--show-token)\b/.test(seg)))) {
    return deny('GitHub credentials are not changed or printed from here.');
  }
  if (sub === 'workflow') {
    if (sub2 === 'run') return ask('Running a workflow is a hosted action. Confirm with the owner.');
    if (['enable', 'disable'].includes(sub2)) return deny('Enabling or disabling workflows is the owner\'s step.');
  }
  if (sub === 'run') {
    if (['rerun', 'cancel'].includes(sub2)) return ask('Re-running or cancelling a workflow is a hosted action. Confirm with the owner.');
    if (sub2 === 'delete') return deny('Deleting workflow runs is not done from here.');
  }
  return null;
}

const SUPABASE_BLOCKED = ['link', 'unlink', 'projects', 'secrets', 'branches', 'orgs', 'domains', 'vanity-subdomains', 'sso', 'network-restrictions', 'ssl-enforcement', 'postgres-config', 'login', 'logout', 'functions', 'deploy'];

function judgeSupabase(seg) {
  const t = seg.split(/\s+/);
  const args = t.slice(t.indexOf('supabase') + 1);
  const [a, b] = args.filter((x) => !x.startsWith('-'));
  if (args.some((x) => x === '--linked' || x.startsWith('--project-ref') || x.startsWith('--project-id'))) {
    return deny('Hosted Supabase commands (--linked, --project-ref) are never run from here. Hosted changes go through the approved GitHub Actions workflow.');
  }
  if (SUPABASE_BLOCKED.includes(a)) return deny('Hosted Supabase commands are never run from here. Hosted changes go through the approved GitHub Actions workflow.');
  if (a === 'db' && ['push', 'pull'].includes(b)) return deny('supabase db push/pull targets a hosted project. Hosted changes go through the approved GitHub Actions workflow.');
  if (a === 'db' && b === 'dump' && !args.includes('--local')) return deny('supabase db dump without --local reads a hosted database.');
  if (a === 'db' && b === 'reset') return deny('Reset the local database only through `pnpm db:reset`, which verifies the target first.');
  if (a === 'migration' && ['repair', 'up', 'squash'].includes(b)) return deny('Migration history is repaired only by the owner, and applied only by the workflow.');
  const dbUrl = args.findIndex((x) => x === '--db-url' || x.startsWith('--db-url='));
  if (dbUrl >= 0) {
    const value = args[dbUrl].includes('=') ? args[dbUrl].split('=').slice(1).join('=') : args[dbUrl + 1] ?? '';
    if (!/@(?:127\.0\.0\.1|localhost):54322\b/.test(value)) return deny('--db-url may only point at this project\'s local database (127.0.0.1:54322).');
  }
  return null;
}

function judgeDocker(seg) {
  const t = seg.split(/\s+/);
  const args = t.slice(1).filter((x) => !x.startsWith('-'));
  const [a, b] = args;
  if (['stop', 'kill', 'rm', 'rmi', 'prune', 'down', 'restart', 'pause'].includes(a)) return deny('Stopping or removing Docker containers and images is not done from here.');
  if (['volume', 'network', 'image', 'container', 'system', 'builder', 'compose'].includes(a) && ['rm', 'prune', 'remove', 'down', 'stop', 'kill'].includes(b)) {
    return deny('Removing Docker volumes, networks or containers is not done from here.');
  }
  return null;
}

const READERS = new Set(['cat', 'less', 'more', 'head', 'tail', 'bat', 'sed', 'awk', 'grep', 'rg', 'xxd', 'base64', 'source', '.', 'cp', 'scp', 'nl', 'od', 'strings']);
const isEnvFile = (tok) => /(?:^|\/)\.env(?:\.[A-Za-z0-9_.-]+)?$/.test(tok) && !/\.example$/.test(tok);

function judgeReads(seg) {
  const t = seg.split(/\s+/);
  const first = t[0];
  if (first === 'printenv' && t.length === 1) return deny('Printing the whole environment would expose secrets.');
  if (first === 'env' && t.length === 1) return deny('Printing the whole environment would expose secrets.');
  if (first === 'export' && t[1] === '-p') return deny('Printing the whole environment would expose secrets.');
  if (READERS.has(first)) {
    if (t.slice(1).some(isEnvFile)) return deny('Environment files hold secrets and are not read from here (only the .example files).');
    if (t.slice(1).some((x) => /\.ssh\/(?:id_|[^/]*_rsa|[^/]*\.pem)/.test(x))) return deny('Private keys are not read from here.');
  }
  return null;
}

function judgeNetwork(seg, whole) {
  const first = seg.split(/\s+/)[0];
  if (!['curl', 'wget', 'http', 'https', 'xh'].includes(first)) return null;
  if (!/\.supabase\.co/.test(whole)) return null;
  const write = /(?:^|\s)(?:-X\s*(?:POST|PUT|PATCH|DELETE)|--request[= ]\s*(?:POST|PUT|PATCH|DELETE)|-d|--data\S*|-F|--form|-T|--upload-file|--json)\b/i;
  return write.test(seg) ? deny('Writing to a hosted Supabase project is not done from here (read-only requests are fine).') : null;
}

function judgeSegment(seg, whole, ctx) {
  const s = norm(seg);
  const head = s.split(/\s+/)[0];
  let r = null;
  if (head === 'git') r = judgeGit(s);
  else if (head === 'gh') r = judgeGh(s, ctx);
  else if (head === 'docker') r = judgeDocker(s);
  if (r) return r;
  if (/(?:^|\s)supabase(?:\s|$)/.test(s) && /^(?:supabase|npx|pnpm|yarn|npm|bunx)\b/.test(s)) r = judgeSupabase(s);
  if (r) return r;
  if (/^(?:pnpm|npm|yarn)\b(?:\s+-\S+)*(?:\s+run)?\s+work\s+(?:approve|attest)\b/.test(s) || /\bcli\.mjs\s+(?:approve|attest)\b/.test(s)) {
    return deny('`work approve` and `work attest` are the owner\'s decisions. The owner runs them (type ! pnpm work approve SL-xxx in the session).');
  }
  return judgeReads(s) ?? judgeNetwork(s, whole);
}

export function decideBash(command, { prBase = defaultPrBase } = {}) {
  const whole = String(command ?? '');
  const { lines, code, nodeCode } = analyze(whole);
  const bareLines = strip(lines);
  const ctx = { prBase };

  if (/55322|superLeagueBackup/i.test(whole)) return deny('The separate superLeagueBackup Supabase project (port 55322) is off-limits.');
  if (/(?:^|[\s;&|(])(?:SKIP_[A-Z0-9_]+|HUSKY|HOOKS_BYPASS)=/.test(bareLines + code)) return deny('There is no bypass variable for the hooks or the gates.');
  if (/core\.hooksPath/.test(bareLines + code)) return deny('The Git hooks path is not changed from here; the hooks are installed by `pnpm hooks:install` and cannot be switched off.');
  if (/\bcli\.mjs\b/.test(nodeCode) && /['"](?:approve|attest)['"]/.test(nodeCode)) return deny('`work approve` and `work attest` are the owner\'s decisions.');

  // What the command writes: records are written only by the work commands; the files that define the gates need the owner.
  const targets = writeTargets(lines);
  if (targets.some((t) => RECORDS.test(t)) || RECORDS.test(code)) return deny('Approvals, attestations and evidence are written only by the work commands, never by hand.');

  let asked = null;
  for (const seg of splitSegments(bareLines)) {
    const r = judgeSegment(seg, whole, ctx);
    if (r?.decision === 'deny') return r;
    if (r?.decision === 'ask') asked = asked ?? r;
  }
  if (asked) return asked;
  if (targets.some((t) => PROTECTED_PATH.test(t)) || PROTECTED_PATH.test(code)) return ask(ENFORCEMENT_ASK);
  return allow;
}

const toPosix = (p) => p.split(sep).join('/');

export function decideEdit(file, { root = process.env.CLAUDE_PROJECT_DIR || process.cwd() } = {}) {
  if (!file) return allow;
  const abs = isAbsolute(file) ? normalize(file) : resolve(root, file);
  const rel = toPosix(relative(root, abs));
  if (rel.startsWith('..')) return allow;
  if (/^backlog\/(?:approvals|attestations|evidence)\//.test(rel)) return deny('Approvals, attestations and evidence are written only by the work commands, never edited by hand.');
  if (/^\.git(?:\/|$)/.test(rel)) return deny('Files inside .git (hooks, config) are not edited from here.');
  // Only the files that define the gates (see PROTECTED_PATH) need the owner's confirmation.
  if (PROTECTED_PATH.test(rel)) return ask(ENFORCEMENT_ASK);
  return allow;
}

function sessionStart(root) {
  const lines = ['Development workflow facts (enforced by scripts, hooks and CI, not by instructions):'];
  const hooks = spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  lines.push(hooks === '.githooks' ? '- Git hooks are installed (pre-commit, commit-msg, pre-push). They have no bypass.' : '- WARNING: the Git hooks are NOT installed in this clone. Run `pnpm hooks:install`.');
  const status = spawnSync('node', [join(root, 'scripts/work/cli.mjs'), 'status'], { cwd: root, encoding: 'utf8' });
  if (status.status === 0) {
    lines.push('- Backlog (`pnpm work status`):');
    for (const l of status.stdout.split('\n').filter(Boolean)) lines.push(`  ${l}`);
  }
  lines.push('- An item must pass `pnpm work ready SL-xxx` (Definition of Ready) before work starts and `pnpm work done SL-xxx` (Definition of Done) before it is finished. Status is never edited by hand.');
  lines.push('- `pnpm work approve` and `pnpm work attest` are the owner\'s; publishing is by pull request from a ready/<name> branch.');
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } };
}

function main(argv) {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (argv[0] === 'session-start') {
    process.stdout.write(`${JSON.stringify(sessionStart(root))}\n`);
    return 0;
  }
  let event;
  try {
    event = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    process.stderr.write('guard: could not read the tool call, so it is blocked to be safe.\n');
    return 2;
  }
  const input = event.tool_input ?? {};
  let verdict = allow;
  if (event.tool_name === 'Bash') verdict = decideBash(input.command);
  else if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(event.tool_name)) verdict = decideEdit(input.file_path ?? input.notebook_path, { root });
  if (verdict.decision === 'deny') {
    process.stderr.write(`Blocked by the project guard: ${verdict.reason}\n`);
    return 2;
  }
  if (verdict.decision === 'ask') {
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: verdict.reason } })}\n`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));

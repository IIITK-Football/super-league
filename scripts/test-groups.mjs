#!/usr/bin/env node
// Test-group runner (SL-014). Groups and path triggers live in tests/groups.json.
//
//   node scripts/test-groups.mjs list
//   node scripts/test-groups.mjs affected [--staged | --base <ref> | --files <f...>] [--dry-run]
//   node scripts/test-groups.mjs run <group...> [--dry-run]
//   node scripts/test-groups.mjs all [--dry-run]       (full / scheduled / release run)
//   node scripts/test-groups.mjs check [--staged (default) | --base <ref> | --files <f...>]   (strict rules only, runs no tests)
//   ... affected --strict      strict rules first, then the affected groups
//   ... --commit-stage        (with check/--strict) skip only the "changed source needs a changed test" rule; push and CI apply it to the whole range
//   ... --evidence <file>      also write machine-readable results (commit, tree, per-command exit codes)
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OWNERS = ['backend', 'frontend', 'platform'];

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

export function loadGroups(path = join(ROOT, 'tests/groups.json')) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function validateGroups(config, root = ROOT) {
  const errors = [];
  for (const [name, g] of Object.entries(config.groups)) {
    if (!g.description) errors.push(`${name}: missing description`);
    if (!OWNERS.includes(g.owner)) errors.push(`${name}: owner must be one of ${OWNERS.join(', ')}`);
    if (!Array.isArray(g.paths) || g.paths.length === 0) errors.push(`${name}: paths required`);
    if (!Array.isArray(g.run)) errors.push(`${name}: run must be an array`);
    if (g.status === 'pending' && !g.pendingFor) errors.push(`${name}: pending groups need pendingFor`);
    if (g.status === 'pending') {
      if ((g.covers ?? []).length > 0) errors.push(`${name}: pending groups cannot cover anything (they have no tests yet)`);
    } else {
      if (!Array.isArray(g.covers) || g.covers.length === 0) errors.push(`${name}: active groups need covers (the source their tests verify)`);
      if (!Array.isArray(g.testPaths) || g.testPaths.length === 0) errors.push(`${name}: active groups need testPaths (which files are their tests)`);
    }
    for (const step of g.run ?? []) {
      if (!existsSync(join(root, step.cwd))) errors.push(`${name}: cwd ${step.cwd} does not exist`);
      if (!Array.isArray(step.cmd) || step.cmd.length === 0) errors.push(`${name}: cmd must be an array`);
    }
  }
  return errors;
}

export function affectedGroups(files, config, { all = false } = {}) {
  const entries = Object.entries(config.groups);
  if (all) return entries.map(([n]) => n);
  const triggers = new Set(config.allGroupsTriggers ?? []);
  const everything = files.some((f) => triggers.has(f));
  return entries
    .filter(([, g]) => !g.scheduledOnly)
    .filter(([, g]) => everything || [...g.paths, ...(g.testPaths ?? [])].some((p) => files.some((f) => globToRegExp(p).test(f))))
    .map(([n]) => n);
}

export function loadExemptions(path = join(ROOT, 'tests/gate-exemptions.json')) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).exemptions ?? [] : [];
}

const matchesAny = (globs, file) => (globs ?? []).some((p) => globToRegExp(p).test(file));

// Strict rules. A change set passes only if, for every changed file that is not an approved exemption:
//   1. some group maps it (otherwise nothing would run for it);
//   2. an ACTIVE group covers it (a pending group has no tests, so it covers nothing);
//   3. the change set also contains a changed or added test file belonging to a group that covers it.
// There is deliberately no per-change opt-out: exemptions are a tracked, reviewed list of categories.
export function checkStrict(files, config, exemptions = [], { onlyUnmapped = false, requireTests = true } = {}) {
  const groups = Object.entries(config.groups);
  const active = groups.filter(([, g]) => g.status !== 'pending');
  const pending = groups.filter(([, g]) => g.status === 'pending');
  const isExempt = (f) => exemptions.some((e) => globToRegExp(e.glob).test(f));
  const isTest = (f) => active.some(([, g]) => matchesAny(g.testPaths, f));
  const changedTests = files.filter(isTest);
  const errors = [];
  for (const f of files) {
    if (isExempt(f) || isTest(f)) continue;
    const mappedBy = groups.filter(([, g]) => matchesAny(g.paths, f) || matchesAny(g.covers, f) || matchesAny(g.testPaths, f));
    if (mappedBy.length === 0) {
      errors.push(`${f}: no group maps this file, so nothing would test it. Add it to a group in tests/groups.json (with tests) or, for a whole category that needs no tests, to tests/gate-exemptions.json.`);
      continue;
    }
    if (onlyUnmapped) continue;
    const covering = active.filter(([, g]) => matchesAny(g.covers, f));
    if (covering.length === 0) {
      const waiting = pending.filter(([, g]) => matchesAny(g.paths, f)).map(([, g]) => g.pendingFor);
      errors.push(`${f}: no active tests cover this path${waiting.length ? ` (tests are pending for ${[...new Set(waiting)].join(', ')})` : ''}. Add tests and register them in tests/groups.json before changing it.`);
      continue;
    }
    if (!requireTests) continue;
    const satisfied = covering.some(([, g]) => changedTests.some((t) => matchesAny(g.testPaths, t)));
    if (!satisfied) {
      errors.push(`${f}: this change needs a changed or added test in ${covering.map(([n]) => n).join(' or ')} (a test file that belongs to a group covering it).`);
    }
  }
  return { errors };
}

// True when any selected group will actually run against the local Supabase stack.
export function needsLocalDatabase(selected, config) {
  return selected.some((n) => config.groups[n]?.requiresLocalDb && config.groups[n].status !== 'pending');
}

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.split('\n').filter(Boolean);
}

export function changedFiles({ staged = false, base = null } = {}) {
  if (staged) return git(['diff', '--cached', '--name-only']);
  if (base) return git(['diff', '--name-only', `${base}...HEAD`]);
  return [...new Set([...git(['diff', '--name-only', 'HEAD']), ...git(['ls-files', '--others', '--exclude-standard'])])];
}

// Changed files that still exist (added, copied, modified, renamed), for the strict rules.
export function changedFilesForStrict({ staged = false, base = null } = {}) {
  const parse = (lines) =>
    lines
      .map((l) => l.split('\t'))
      .filter(([status]) => !status.startsWith('D'))
      .map((cols) => cols[cols.length - 1]);
  if (staged) return parse(git(['diff', '--cached', '--name-status']));
  if (base) return parse(git(['diff', '--name-status', `${base}...HEAD`]));
  return [...new Set([...parse(git(['diff', '--name-status', 'HEAD'])), ...git(['ls-files', '--others', '--exclude-standard'])])];
}

function gitValue(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

function writeEvidence(path, selected, results, dryRun) {
  const evidence = {
    head: gitValue(['rev-parse', 'HEAD']),
    tree: gitValue(['rev-parse', 'HEAD^{tree}']),
    clean: gitValue(['status', '--porcelain', '--untracked-files=no']) === '',
    dryRun,
    at: new Date().toISOString(),
    groups: results.map((r) => ({ name: r.name, state: r.state, note: r.note, commands: r.commands ?? [] })),
    selected,
  };
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`evidence written to ${path}`);
}

function runGroup(name, g) {
  if (g.status === 'pending') return { name, state: 'pending', note: `no tests yet (${g.pendingFor})` };
  if (g.requiresLocalDb) {
    const chk = spawnSync('bash', ['scripts/local-db.sh', 'check'], { cwd: ROOT, stdio: 'inherit' });
    if (chk.status !== 0) return { name, state: 'failed', note: 'local Supabase check failed (start it with: pnpm db:start)' };
  }
  const commands = [];
  for (const step of g.run) {
    console.log(`\n▶ [${name}] (${step.cwd}) ${step.cmd.join(' ')}`);
    const started = Date.now();
    const r = spawnSync(step.cmd[0], step.cmd.slice(1), { cwd: join(ROOT, step.cwd), stdio: 'inherit' });
    commands.push({ cwd: step.cwd, cmd: step.cmd.join(' '), exit: r.status, ms: Date.now() - started });
    if (r.status !== 0) return { name, state: 'failed', note: `${step.cmd.join(' ')} exited ${r.status}`, commands };
  }
  return { name, state: 'passed', note: '', commands };
}

function report(selected, all, results, dryRun) {
  const skipped = all.filter((n) => !selected.includes(n));
  const lines = [
    '### Test groups',
    '',
    '| Group | Result |',
    '|---|---|',
    ...results.map((r) => `| ${r.name} | ${dryRun ? 'selected (dry run)' : r.state}${r.note ? ` — ${r.note}` : ''} |`),
    ...skipped.map((n) => `| ${n} | not affected |`),
    '',
  ];
  const text = lines.join('\n');
  console.log(`\n${text}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

function main(argv) {
  const config = loadGroups();
  const errors = validateGroups(config);
  if (errors.length) {
    console.error(`tests/groups.json is invalid:\n- ${errors.join('\n- ')}`);
    return 2;
  }
  const names = Object.keys(config.groups);
  const [cmd, ...rest] = argv;
  const dryRun = rest.includes('--dry-run');
  const strict = rest.includes('--strict');
  const evIndex = rest.indexOf('--evidence');
  const evidencePath = evIndex >= 0 ? rest[evIndex + 1] : null;
  const args = rest.filter((a, i) => a !== '--dry-run' && a !== '--strict' && a !== '--evidence' && !(evIndex >= 0 && i === evIndex + 1));

  if (cmd === 'list') {
    for (const [n, g] of Object.entries(config.groups)) {
      console.log(`${n.padEnd(22)} ${g.owner.padEnd(9)} ${g.status === 'pending' ? `pending (${g.pendingFor})` : 'active'.padEnd(8)} ${g.description}`);
    }
    return 0;
  }

  const strictFiles = () => {
    const fi = args.indexOf('--files');
    const bi = args.indexOf('--base');
    if (fi >= 0) return args.slice(fi + 1);
    if (bi >= 0) return changedFilesForStrict({ base: args[bi + 1] });
    return changedFilesForStrict({ staged: true });
  };
  const runStrictCheck = () => {
    const files = strictFiles();
    const { errors } = checkStrict(files, config, loadExemptions(), { requireTests: !args.includes('--commit-stage') });
    if (errors.length) {
      console.error(`strict check failed (${errors.length} problem${errors.length === 1 ? '' : 's'} in ${files.length} changed files):\n- ${errors.join('\n- ')}`);
      return false;
    }
    console.log(`strict check passed (${files.length} changed files)`);
    return true;
  };

  if (cmd === 'check') return runStrictCheck() ? 0 : 1;
  if (strict && cmd === 'affected' && !runStrictCheck()) return 1;

  let selected;
  if (cmd === 'all') selected = names;
  else if (cmd === 'run') {
    const unknown = args.filter((a) => !config.groups[a]);
    if (!args.length || unknown.length) {
      console.error(`unknown or missing group(s): ${unknown.join(', ') || '(none given)'}. Known: ${names.join(', ')}`);
      return 2;
    }
    selected = args;
  } else if (cmd === 'affected') {
    let files;
    const fi = args.indexOf('--files');
    const bi = args.indexOf('--base');
    if (fi >= 0) files = args.slice(fi + 1);
    else if (bi >= 0) files = changedFiles({ base: args[bi + 1] });
    else files = changedFiles({ staged: args.includes('--staged') });
    selected = affectedGroups(files, config);
    console.log(`changed files: ${files.length}; affected groups: ${selected.join(', ') || '(none)'}`);
  } else {
    console.error('usage: test-groups.mjs {list|check|affected|run <group...>|all} [--strict] [--evidence <file>] [--dry-run]');
    return 2;
  }

  console.log(`needs local database: ${needsLocalDatabase(selected, config)}`);
  const results = selected.map((n) => (dryRun ? { name: n, state: 'selected', note: '' } : runGroup(n, config.groups[n])));
  report(selected, names, results, dryRun);
  if (evidencePath) writeEvidence(evidencePath, selected, results, dryRun);
  return results.some((r) => r.state === 'failed') ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}

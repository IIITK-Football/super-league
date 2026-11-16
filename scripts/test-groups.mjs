#!/usr/bin/env node
// Test-group runner (SL-014). Groups and path triggers live in tests/groups.json.
//
//   node scripts/test-groups.mjs list
//   node scripts/test-groups.mjs affected [--staged | --base <ref> | --files <f...>] [--dry-run]
//   node scripts/test-groups.mjs run <group...> [--dry-run]
//   node scripts/test-groups.mjs all [--dry-run]       (full / scheduled / release run)
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
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
    .filter(([, g]) => everything || g.paths.some((p) => files.some((f) => globToRegExp(p).test(f))))
    .map(([n]) => n);
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

function runGroup(name, g) {
  if (g.status === 'pending') return { name, state: 'pending', note: `no tests yet (${g.pendingFor})` };
  if (g.requiresLocalDb) {
    const chk = spawnSync('bash', ['scripts/local-db.sh', 'check'], { cwd: ROOT, stdio: 'inherit' });
    if (chk.status !== 0) return { name, state: 'failed', note: 'local Supabase check failed (start it with: pnpm db:start)' };
  }
  for (const step of g.run) {
    console.log(`\n▶ [${name}] (${step.cwd}) ${step.cmd.join(' ')}`);
    const r = spawnSync(step.cmd[0], step.cmd.slice(1), { cwd: join(ROOT, step.cwd), stdio: 'inherit' });
    if (r.status !== 0) return { name, state: 'failed', note: `${step.cmd.join(' ')} exited ${r.status}` };
  }
  return { name, state: 'passed', note: '' };
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
  const args = rest.filter((a) => a !== '--dry-run');

  if (cmd === 'list') {
    for (const [n, g] of Object.entries(config.groups)) {
      console.log(`${n.padEnd(22)} ${g.owner.padEnd(9)} ${g.status === 'pending' ? `pending (${g.pendingFor})` : 'active'.padEnd(8)} ${g.description}`);
    }
    return 0;
  }

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
    console.error('usage: test-groups.mjs {list|affected|run <group...>|all} [--dry-run]');
    return 2;
  }

  console.log(`needs local database: ${needsLocalDatabase(selected, config)}`);
  const results = selected.map((n) => (dryRun ? { name: n, state: 'selected', note: '' } : runGroup(n, config.groups[n])));
  report(selected, names, results, dryRun);
  return results.some((r) => r.state === 'failed') ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}

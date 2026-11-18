#!/usr/bin/env node
// pnpm work <command>: the enforced development workflow.
//
//   work status [SL-xxx]            what is open, and what an item still needs
//   work approve SL-xxx             OPTIONAL, OWNER ONLY: record approval of the item's plan (stores the plan's hash)
//   work ready SL-xxx               OPTIONAL strict readiness (plan, approval, checks); not required to start
//   work start SL-xxx               not-started (or ready) -> in-progress; only the ORDER is checked
//   work attest SL-xxx C2 [note]    OWNER ONLY: attest a manual acceptance check
//   work done SL-xxx [--base <ref>] Definition of Done: runs the item's groups and checks, records evidence, writes the
//                                   walkthrough skeleton, and marks the item done only when the walkthrough is complete
//   work check [--base <ref>]       what CI runs: validate the backlog and every status change since <ref>
//   work audit [--repo|--local|--remote]  verify the enforcement is really in place (read-only)
//
// `approve` and `attest` are the owner's decisions. The Claude Code guard denies them to the agent's shell; the owner
// runs them with `!` in a session or in a terminal. Status values are changed only by these commands.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMPLETE,
  ROOT,
  approvalPath,
  loadBacklog,
  planProblems,
  readyProblems,
  saveItem,
  sha256,
  startProblems,
  transitionProblems,
  validateBacklog,
} from './backlog.mjs';
import { parseItem } from './frontmatter.mjs';
import { runAudit } from './audit.mjs';
import { buildSkeleton, refreshGenerated, walkthroughProblems } from './walkthrough.mjs';
import { checkStrict, globToRegExp, loadExemptions } from '../test-groups.mjs';

function gitUser(root) {
  const r = spawnSync('git', ['config', 'user.name'], { cwd: root, encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : 'unknown';
}

function gitShow(root, ref, path) {
  const r = spawnSync('git', ['show', `${ref}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

function gitLines(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
}

function readJson(path, fallback = null) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

// Runs the item's test groups with the project's own runner and returns its machine-readable evidence.
function defaultRunGroups(groups, { root }) {
  const file = join(mkdtempSync(join(tmpdir(), 'work-evidence-')), 'evidence.json');
  spawnSync('node', [join(root, 'scripts/test-groups.mjs'), 'run', ...groups, '--evidence', file], { cwd: root, stdio: 'inherit' });
  return JSON.parse(readFileSync(file, 'utf8'));
}

function defaultRunCommand(command, { root }) {
  return { exit: spawnSync('bash', ['-c', command], { cwd: root, stdio: 'inherit' }).status ?? 1 };
}

// Tracked files with uncommitted changes, ignoring files in the approved exemption list (docs, backlog records,
// personal ignore rules): evidence is recorded against a commit, so everything that could change a test must be committed.
function dirtyFiles(root) {
  const exemptions = (readJson(join(root, 'tests/gate-exemptions.json'), { exemptions: [] }).exemptions ?? []).map((e) => globToRegExp(e.glob));
  return gitLines(root, ['status', '--porcelain', '--untracked-files=no'])
    .map((l) => l.slice(3).replace(/^.* -> /, ''))
    .filter((f) => !exemptions.some((re) => re.test(f)));
}

// Problems with a finished item's walkthrough and evidence (used by CI for every item whose status is done).
export function doneItemProblems(item, bl, root) {
  const id = item.meta.id;
  const problems = [];
  const walkthroughRel = item.meta.walkthrough ?? `docs/walkthroughs/${id}.md`;
  const evidencePath = join(root, `backlog/evidence/${id}.json`);
  const walkthroughPath = join(root, walkthroughRel);
  if (!existsSync(walkthroughPath)) problems.push(`${id}: done needs its walkthrough ${walkthroughRel}, which is missing`);
  if (!existsSync(evidencePath)) problems.push(`${id}: done needs its evidence backlog/evidence/${id}.json, which is missing`);
  if (problems.length) return problems;
  const evidence = readJson(evidencePath);
  const attestations = readJson(join(root, `backlog/attestations/${id}.json`), { attestations: [] }).attestations;
  if (evidence.clean !== true) problems.push(`${id}: the evidence was not recorded on a clean tree`);
  if (evidence.dryRun) problems.push(`${id}: the evidence comes from a dry run`);
  for (const g of item.meta.groups ?? []) {
    const ran = evidence.groups?.find((x) => x.name === g);
    if (!ran) problems.push(`${id}: the evidence has no run of required group ${g}`);
    else if (ran.state !== 'passed') problems.push(`${id}: required group ${g} did not pass in the evidence`);
  }
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', evidence.head ?? '', 'HEAD'], { cwd: root });
  // If history was rewritten the commit hash is gone but the tree (the content the tests ran on) is still in the history.
  const treeKnown = evidence.tree && gitLines(root, ['log', '--format=%T', 'HEAD']).includes(evidence.tree);
  if (ancestor.status !== 0 && !treeKnown) problems.push(`${id}: the evidence commit ${String(evidence.head).slice(0, 7)} is not part of this history`);
  problems.push(...walkthroughProblems(readFileSync(walkthroughPath, 'utf8'), { item, bl, evidence, attestations }).map((p) => `${id}: ${p}`));
  return problems;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function run(argv, { root = ROOT, out = console.log, err = console.error, user = gitUser(root), now = () => new Date(), runGroups = defaultRunGroups, runCommand = defaultRunCommand } = {}) {
  const [cmd, id, ...rest] = argv;
  const bl = loadBacklog(root);
  const fail = (lines) => {
    for (const l of [].concat(lines)) err(l);
    return 1;
  };
  const need = () => {
    if (!id) return { error: fail(`usage: work ${cmd} SL-xxx`) };
    const item = bl.items.get(id);
    const gone = (bl.superseded ?? []).find((s) => s.id === id);
    if (!item && gone) return { error: fail(`${id}: superseded by ${gone.by.join(', ')} (${gone.date ?? 'undated'}): ${gone.note}`) };
    if (!item) return { error: fail(`${id}: no such backlog item`) };
    return { item };
  };

  if (cmd === 'status') {
    if (!id) {
      const counts = {};
      for (const { meta } of bl.items.values()) counts[meta.status] = (counts[meta.status] ?? 0) + 1;
      for (const [s, n] of Object.entries(counts).sort()) out(`${s.padEnd(12)} ${n}`);
      for (const { meta } of bl.items.values()) if (['ready', 'in-progress', 'blocked'].includes(meta.status)) out(`${meta.status.padEnd(12)} ${meta.id}  ${meta.title}`);
      return 0;
    }
    const { item, error } = need();
    if (error) return error;
    out(`${item.meta.id}  ${item.meta.title}\nphase ${item.meta.phase}, status ${item.meta.status}${item.meta.legacy ? ' (legacy)' : ''}`);
    if (item.meta.status === 'not-started') {
      const problems = readyProblems(item, bl, { root });
      out(problems.length ? `Not ready yet:\n- ${problems.join('\n- ')}` : 'Definition of Ready is met.');
    }
    return 0;
  }

  if (cmd === 'approve') {
    const { item, error } = need();
    if (error) return error;
    if (!item.meta.plan) return fail(`${id}: set "plan: docs/plans/${id}.md" in the item first`);
    const planFile = join(root, item.meta.plan);
    if (!existsSync(planFile)) return fail(`${id}: plan ${item.meta.plan} does not exist`);
    const planText = readFileSync(planFile, 'utf8');
    const problems = planProblems(planText);
    if (problems.length) return fail(problems.map((p) => `${id}: ${p}`));
    writeJson(approvalPath(id, root), { id, planSha256: sha256(planText), approvedBy: user, approvedAt: now().toISOString() });
    out(`Approved the plan for ${id} (${sha256(planText).slice(0, 12)}). Editing the plan later needs a new approval.`);
    return 0;
  }

  if (cmd === 'ready') {
    const { item, error } = need();
    if (error) return error;
    if (item.meta.status !== 'not-started') return fail(`${id}: status is ${item.meta.status}; only a not-started item can become ready`);
    const problems = readyProblems(item, bl, { root });
    if (problems.length) return fail(['Definition of Ready is not met:', ...problems.map((p) => `- ${p}`)]);
    item.meta.status = 'ready';
    saveItem(item);
    out(`${id} is ready.`);
    return 0;
  }

  if (cmd === 'start') {
    const { item, error } = need();
    if (error) return error;
    if (!['not-started', 'ready'].includes(item.meta.status)) return fail(`${id}: status is ${item.meta.status}; only a not-started or ready item can start`);
    const problems = startProblems(item, bl);
    if (problems.length) return fail(['This item cannot start yet:', ...problems.map((p) => `- ${p}`)]);
    item.meta.status = 'in-progress';
    item.meta.startCommit = gitLines(root, ['rev-parse', 'HEAD'])[0] ?? '';
    saveItem(item);
    out(`${id} is in progress.`);
    return 0;
  }

  if (cmd === 'attest') {
    const { item, error } = need();
    if (error) return error;
    const [checkId, ...noteWords] = rest;
    if (item.meta.status !== 'in-progress') return fail(`${id}: attestations are recorded while the item is in progress (status is ${item.meta.status})`);
    const check = (item.meta.checks ?? []).find((c) => c.id === checkId);
    if (!check) return fail(`${id}: no check ${checkId ?? '(none given)'}`);
    if (!check.verify.startsWith('manual:')) return fail(`${id}: ${checkId} is not a manual check (${check.verify}); automated checks are run, not attested`);
    const path = join(root, `backlog/attestations/${id}.json`);
    const existing = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).attestations : [];
    const next = [...existing.filter((a) => a.checkId !== checkId), { checkId, by: user, at: now().toISOString(), note: noteWords.join(' ') }];
    writeJson(path, { id, attestations: next });
    out(`Attested ${id} ${checkId}: ${check.text}`);
    return 0;
  }

  if (cmd === 'done') {
    const { item, error } = need();
    if (error) return error;
    if (item.meta.status !== 'in-progress') return fail(`${id}: status is ${item.meta.status}; the item must be in-progress to be finished`);
    const bi = argv.indexOf('--base');
    const base = bi >= 0 ? argv[bi + 1] : item.meta.startCommit;
    if (!base) return fail(`${id}: no recorded start; pass --base <the commit before this work began>`);
    const dirty = dirtyFiles(root);
    if (dirty.length) return fail([`${id}: uncommitted changes to tracked files; evidence is recorded against a commit, so commit or stash first:`, ...dirty.map((f) => `- ${f}`)]);
    const groups = item.meta.groups ?? [];
    const pending = groups.filter((g) => bl.groups[g]?.status === 'pending');
    if (pending.length) return fail(`${id}: pending groups cannot verify anything: ${pending.join(', ')}`);

    // Cheap prerequisites first: no point spending minutes on test groups if the item cannot be finished anyway.
    const attestations = readJson(join(root, `backlog/attestations/${id}.json`), { attestations: [] }).attestations;
    const testGlobs = groups.flatMap((g) => bl.groups[g]?.testPaths ?? []);
    const early = [];
    for (const c of item.meta.checks ?? []) {
      const [kind, ...restParts] = c.verify.split(':');
      const target = restParts.join(':');
      if (kind === 'test') {
        if (!existsSync(join(root, target))) early.push(`${id}: ${c.id}: test file ${target} does not exist`);
        else if (!testGlobs.some((glob) => globToRegExp(glob).test(target))) early.push(`${id}: ${c.id}: ${target} is not a test of this item's groups`);
      } else if (kind === 'manual' && !attestations.some((a) => a.checkId === c.id)) {
        early.push(`${id}: ${c.id}: manual check not attested (the owner runs: pnpm work attest ${id} ${c.id})`);
      }
    }
    if (early.length) return fail(['Definition of Done is not met (nothing was run):', ...early.map((p) => `- ${p}`)]);

    const evidence = runGroups(groups, { root });
    const problems = [];
    for (const g of evidence.groups) if (g.state !== 'passed') problems.push(`${id}: group ${g.name} failed (${g.note || g.state})`);
    evidence.commandChecks = {};
    for (const c of item.meta.checks ?? []) {
      const [kind, ...restParts] = c.verify.split(':');
      if (kind !== 'command') continue;
      const target = restParts.join(':');
      const r = runCommand(target, { root });
      evidence.commandChecks[c.id] = { exit: r.exit };
      if (r.exit !== 0) problems.push(`${id}: ${c.id}: command failed (exit ${r.exit}): ${target}`);
    }
    if (problems.length) return fail(['Definition of Done is not met:', ...problems.map((p) => `- ${p}`)]);

    const record = { ...evidence, id, base };
    const evidencePath = join(root, `backlog/evidence/${id}.json`);
    writeJson(evidencePath, record);
    const walkthroughRel = `docs/walkthroughs/${id}.md`;
    const walkthroughPath = join(root, walkthroughRel);
    const ctx = {
      item,
      bl,
      evidence: record,
      attestations,
      commits: gitLines(root, ['log', '--reverse', '--format=%H%x09%s', `${base}..HEAD`]).map((l) => ({ sha: l.split('\t')[0], subject: l.split('\t').slice(1).join('\t') })),
      files: gitLines(root, ['diff', '--name-only', `${base}..HEAD`]),
    };
    if (!existsSync(walkthroughPath)) {
      mkdirSync(dirname(walkthroughPath), { recursive: true });
      writeFileSync(walkthroughPath, buildSkeleton(ctx));
      return fail([`Evidence recorded. Fill in ${walkthroughRel} (every TODO), commit, then run this command again.`]);
    }
    const text = refreshGenerated(readFileSync(walkthroughPath, 'utf8'), ctx);
    writeFileSync(walkthroughPath, text);
    const open = walkthroughProblems(text, ctx);
    if (open.length) return fail([`The walkthrough ${walkthroughRel} is not complete:`, ...open.map((p) => `- ${p}`)]);
    item.meta.status = 'done';
    item.meta.walkthrough = walkthroughRel;
    saveItem(item);
    out(`${id} is done. Commit the item, its evidence and its walkthrough together.`);
    return 0;
  }

  // Re-record the evidence of a finished item whose evidence is unusable (for example recorded while an exempt file
  // was uncommitted, so it is not from a clean tree). Only on a fully clean tree; it re-runs every required group and
  // writes nothing unless all pass. Status, checks and the owner's attestations are not touched, and the walkthrough
  // must still be complete.
  if (cmd === 'rerecord') {
    const { item, error } = need();
    if (error) return error;
    if (item.meta.status !== 'done') return fail(`${id}: status is ${item.meta.status}; only a done item's evidence can be re-recorded (finish an item with: pnpm work done ${id})`);
    const unclean = gitLines(root, ['status', '--porcelain', '--untracked-files=no']);
    if (unclean.length) return fail([`${id}: the tree must be fully clean (evidence is recorded against a commit); commit or stash:`, ...unclean.map((l) => `- ${l.slice(3)}`)]);
    const evidencePath = join(root, `backlog/evidence/${id}.json`);
    const previous = readJson(evidencePath, {});
    const base = previous?.base ?? item.meta.startCommit;
    if (!base) return fail(`${id}: no recorded base for this item's evidence`);
    const groups = item.meta.groups ?? [];
    const evidence = runGroups(groups, { root });
    const problems = [];
    if (evidence.clean !== true) problems.push(`${id}: the tree changed while the groups ran`);
    for (const g of groups) if (!evidence.groups.some((x) => x.name === g && x.state === 'passed')) problems.push(`${id}: group ${g} did not pass`);
    evidence.commandChecks = {};
    for (const c of item.meta.checks ?? []) {
      const [kind, ...restParts] = c.verify.split(':');
      if (kind !== 'command') continue;
      const r = runCommand(restParts.join(':'), { root });
      evidence.commandChecks[c.id] = { exit: r.exit };
      if (r.exit !== 0) problems.push(`${id}: ${c.id}: command failed (exit ${r.exit})`);
    }
    if (problems.length) return fail(['Evidence not re-recorded (nothing was written):', ...problems.map((p) => `- ${p}`)]);
    const record = { ...evidence, id, base };
    const walkthroughRel = item.meta.walkthrough ?? `docs/walkthroughs/${id}.md`;
    const walkthroughPath = join(root, walkthroughRel);
    if (!existsSync(walkthroughPath)) return fail(`${id}: the walkthrough ${walkthroughRel} is missing`);
    const ctx = {
      item,
      bl,
      evidence: record,
      attestations: readJson(join(root, `backlog/attestations/${id}.json`), { attestations: [] }).attestations,
      commits: gitLines(root, ['log', '--reverse', '--format=%H%x09%s', `${base}..HEAD`]).map((l) => ({ sha: l.split('\t')[0], subject: l.split('\t').slice(1).join('\t') })),
      files: gitLines(root, ['diff', '--name-only', `${base}..HEAD`]),
    };
    const text = refreshGenerated(readFileSync(walkthroughPath, 'utf8'), ctx);
    const open = walkthroughProblems(text, ctx);
    if (open.length) return fail([`Evidence not re-recorded: the walkthrough ${walkthroughRel} is not complete:`, ...open.map((p) => `- ${p}`)]);
    writeJson(evidencePath, record);
    writeFileSync(walkthroughPath, text);
    out(`${id}: evidence re-recorded on a clean tree. Commit the evidence and walkthrough together.`);
    return 0;
  }

  // Phase completion: the one place where validation is rigid and slow. Everything is checked up front, every active
  // test group runs once, and every item gets its evidence and walkthrough together. Run again after the walkthroughs
  // are written to finish the phase.
  if (cmd === 'phase') {
    const n = Number(id);
    if (!Number.isInteger(n)) return fail('usage: work phase <number> --base <the commit before the phase began>');
    const items = [...bl.items.values()].filter((i) => i.meta.phase === n);
    if (items.length === 0) return fail(`phase ${n} has no items`);
    const unfinished = items.filter((i) => !COMPLETE.includes(i.meta.status));
    if (unfinished.length === 0) {
      out(`Phase ${n} is already complete.`);
      return 0;
    }
    const notRunning = unfinished.filter((i) => i.meta.status !== 'in-progress');
    if (notRunning.length) return fail([`Phase ${n} cannot be completed: these items are not in progress:`, ...notRunning.map((i) => `- ${i.meta.id} (${i.meta.status})`)]);
    const bi = argv.indexOf('--base');
    const base = bi >= 0 ? argv[bi + 1] : null;
    if (!base) return fail(`phase ${n}: pass --base <the commit before the phase began>`);

    // 1. Every prerequisite of every item, reported together, before anything slow runs.
    const attestations = (itemId) => readJson(join(root, `backlog/attestations/${itemId}.json`), { attestations: [] }).attestations;
    const early = [];
    for (const { meta } of unfinished) {
      if ((meta.groups ?? []).length === 0) early.push(`${meta.id}: no test groups defined`);
      if ((meta.checks ?? []).length === 0) early.push(`${meta.id}: no acceptance checks defined`);
      const globs = (meta.groups ?? []).flatMap((g) => bl.groups[g]?.testPaths ?? []);
      for (const c of meta.checks ?? []) {
        const target = c.verify.split(':').slice(1).join(':');
        if (c.verify.startsWith('test:')) {
          if (!existsSync(join(root, target))) early.push(`${meta.id}: ${c.id}: test file ${target} does not exist`);
          else if (!globs.some((glob) => globToRegExp(glob).test(target))) early.push(`${meta.id}: ${c.id}: ${target} is not a test of this item's groups`);
        } else if (c.verify.startsWith('manual:') && !attestations(meta.id).some((a) => a.checkId === c.id)) {
          early.push(`${meta.id}: ${c.id}: manual check not attested (the owner runs: pnpm work attest ${meta.id} ${c.id})`);
        }
      }
    }
    if (early.length) return fail([`Phase ${n} cannot be completed yet (nothing was run):`, ...early.map((p) => `- ${p}`)]);

    // 2. The strict file rules over everything the phase changed (mapped, covered, and tested).
    const changed = gitLines(root, ['diff', '--name-status', `${base}...HEAD`]).filter((l) => !l.startsWith('D')).map((l) => l.split('\t').pop());
    const strict = checkStrict(changed, { groups: bl.groups }, loadExemptions(join(root, 'tests/gate-exemptions.json'))).errors;
    if (strict.length) return fail([`Phase ${n}: the strict test rules failed (${strict.length}):`, ...strict.map((p) => `- ${p}`)]);

    // 3. Every active test group, once. Each item then records the shared evidence.
    const active = Object.entries(bl.groups).filter(([, g]) => g.status !== 'pending').map(([name]) => name);
    const evidence = runGroups(active, { root });
    const failedGroups = evidence.groups.filter((g) => g.state !== 'passed');
    if (failedGroups.length) return fail([`Phase ${n}: test groups failed:`, ...failedGroups.map((g) => `- ${g.name}: ${g.note || g.state}`)]);

    // 4. Evidence and a walkthrough for every item (the existing per-item completion, fed the shared evidence).
    const results = unfinished.map((i) => run(['done', i.meta.id, '--base', base], { root, out, err, user, now, runGroups: () => structuredClone(evidence), runCommand }));
    const stillOpen = loadBacklog(root);
    const open = items.filter((i) => !COMPLETE.includes(stillOpen.items.get(i.meta.id).meta.status));
    if (open.length === 0 && results.every((r) => r === 0)) {
      out(`Phase ${n} is complete. Commit the items, evidence and walkthroughs together.`);
      return 0;
    }
    return fail([`Phase ${n}: ${open.length} item(s) still need their walkthrough text: ${open.map((i) => i.meta.id).join(', ')}.`]);
  }

  if (cmd === 'audit') return runAudit(argv.slice(1), { root, out, gh: undefined });

  if (cmd === 'check') {
    const problems = validateBacklog(bl);
    for (const item of bl.items.values()) if (item.meta.status === 'done') problems.push(...doneItemProblems(item, bl, root));
    const bi = argv.indexOf('--base');
    if (bi >= 0) {
      const base = argv[bi + 1];
      const hadBacklog = spawnSync('git', ['ls-tree', '-d', '--name-only', base, 'backlog/items'], { cwd: root, encoding: 'utf8' }).stdout.trim() !== '';
      for (const [itemId, item] of bl.items) {
        const baseText = gitShow(root, base, `backlog/items/${itemId}.md`);
        let from = null;
        if (baseText !== null) {
          try {
            from = parseItem(baseText).meta.status;
          } catch {
            from = null;
          }
        }
        const to = item.meta.status;
        const tp = transitionProblems(from, to, { bootstrap: !hadBacklog });
        problems.push(...tp.map((p) => `${itemId}: ${p}`));
        if (tp.length || from === to) continue;
        if (to === 'ready' && item.meta.legacy !== true) problems.push(...readyProblems(item, bl, { root }));
        if (to === 'in-progress' && ['not-started', 'ready'].includes(from) && item.meta.legacy !== true) problems.push(...startProblems(item, bl));
      }
    }
    if (problems.length) return fail([`backlog check failed (${problems.length}):`, ...problems.map((p) => `- ${p}`)]);
    out(`backlog check passed (${bl.items.size} items)`);
    return 0;
  }

  return fail('usage: work {status [id] | approve id | ready id | start id | attest id check [note] | done id [--base ref] | rerecord id | check [--base ref] | audit}');
}

if (process.argv[1] && join(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(run(process.argv.slice(2), { root: process.env.WORK_ROOT || ROOT }));
}

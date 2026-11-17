#!/usr/bin/env node
// pnpm work <command>: the enforced development workflow.
//
//   work status [SL-xxx]            what is open, and what an item still needs
//   work approve SL-xxx             OWNER ONLY: record approval of the item's plan (stores the plan's hash)
//   work ready SL-xxx               Definition of Ready; moves not-started -> ready
//   work start SL-xxx               ready -> in-progress
//   work attest SL-xxx C2 [note]    OWNER ONLY: attest a manual acceptance check
//   work check [--base <ref>]       what CI runs: validate the backlog and every status change since <ref>
//
// `approve` and `attest` are the owner's decisions. The Claude Code guard denies them to the agent's shell; the owner
// runs them with `!` in a session or in a terminal. Status values are changed only by these commands.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMPLETE,
  ROOT,
  approvalPath,
  loadBacklog,
  phaseGateProblems,
  planProblems,
  readyProblems,
  saveItem,
  sha256,
  transitionProblems,
  validateBacklog,
} from './backlog.mjs';
import { parseItem } from './frontmatter.mjs';

function gitUser(root) {
  const r = spawnSync('git', ['config', 'user.name'], { cwd: root, encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : 'unknown';
}

function gitShow(root, ref, path) {
  const r = spawnSync('git', ['show', `${ref}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function run(argv, { root = ROOT, out = console.log, err = console.error, user = gitUser(root), now = () => new Date() } = {}) {
  const [cmd, id, ...rest] = argv;
  const bl = loadBacklog(root);
  const fail = (lines) => {
    for (const l of [].concat(lines)) err(l);
    return 1;
  };
  const need = () => {
    if (!id) return { error: fail(`usage: work ${cmd} SL-xxx`) };
    const item = bl.items.get(id);
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
    if (item.meta.status !== 'ready') return fail(`${id}: status is ${item.meta.status}; it must be ready before it can start (work ready ${id})`);
    const problems = readyProblems(item, bl, { root });
    if (problems.length) return fail(['Definition of Ready no longer holds:', ...problems.map((p) => `- ${p}`)]);
    item.meta.status = 'in-progress';
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

  if (cmd === 'check') {
    const problems = validateBacklog(bl);
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
        if (to === 'done' && !COMPLETE.includes(from)) {
          const walkthrough = join(root, item.meta.walkthrough ?? `docs/walkthroughs/${itemId}.md`);
          if (!existsSync(walkthrough)) problems.push(`${itemId}: done needs its walkthrough ${item.meta.walkthrough ?? `docs/walkthroughs/${itemId}.md`}, which is missing`);
          if (!existsSync(join(root, `backlog/evidence/${itemId}.json`))) problems.push(`${itemId}: done needs its evidence backlog/evidence/${itemId}.json, which is missing`);
        }
        if (to === 'in-progress' && from === 'ready') problems.push(...phaseGateProblems(item, bl));
      }
    }
    if (problems.length) return fail([`backlog check failed (${problems.length}):`, ...problems.map((p) => `- ${p}`)]);
    out(`backlog check passed (${bl.items.size} items)`);
    return 0;
  }

  return fail('usage: work {status [id] | approve id | ready id | start id | attest id check [note] | check [--base ref]}');
}

if (process.argv[1] && join(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(run(process.argv.slice(2), { root: process.env.WORK_ROOT || ROOT }));
}

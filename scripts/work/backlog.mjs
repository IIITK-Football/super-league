// The backlog model behind `pnpm work`: loads backlog/ (one Markdown file per item with machine-readable front
// matter, plus rules.json and decisions.json), validates it, and decides what Definition of Ready, phase gating and
// status transitions allow. Pure reads: nothing here writes except the explicit save helpers.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globToRegExp } from '../test-groups.mjs';
import { parseItem, serializeItem } from './frontmatter.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const STATUSES = ['not-started', 'ready', 'in-progress', 'done', 'blocked', 'legacy-done'];
export const COMPLETE = ['done', 'legacy-done'];
const PLAN_SECTIONS = ['Issue', 'Evidence', 'Scope', 'Acceptance checks', 'Tests', 'Rollback'];

const EDGES = {
  'not-started': ['ready'],
  ready: ['in-progress', 'not-started'],
  'in-progress': ['done', 'blocked'],
  blocked: ['in-progress'],
  done: [],
  'legacy-done': [],
};

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export function loadBacklog(root = ROOT) {
  const dir = join(root, 'backlog/items');
  const items = new Map();
  const parseErrors = [];
  if (existsSync(dir)) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
      const path = join(dir, file);
      try {
        const { meta, body } = parseItem(readFileSync(path, 'utf8'));
        items.set(file.replace(/\.md$/, ''), { meta, body, path, file });
      } catch (e) {
        parseErrors.push(`${file}: ${e.message}`);
      }
    }
  }
  const json = (rel, key) => {
    const p = join(root, rel);
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8'))[key] ?? [] : [];
  };
  const groupsPath = join(root, 'tests/groups.json');
  return {
    root,
    items,
    parseErrors,
    rules: json('backlog/rules.json', 'rules'),
    decisions: json('backlog/decisions.json', 'decisions'),
    groups: existsSync(groupsPath) ? JSON.parse(readFileSync(groupsPath, 'utf8')).groups : {},
  };
}

export function saveItem(item) {
  writeFileSync(item.path, serializeItem({ meta: item.meta, body: item.body }));
}

function checkProblems(id, checks) {
  const problems = [];
  const seen = new Set();
  for (const c of checks ?? []) {
    if (!c.id || !c.text) problems.push(`${id}: every check needs an id and text`);
    if (seen.has(c.id)) problems.push(`${id}: duplicate check id ${c.id}`);
    seen.add(c.id);
    if (!/^(test:.+|command:(pnpm|node) .+|manual:[A-Za-z][\w-]*)$/.test(c.verify ?? '')) {
      problems.push(`${id}: ${c.id} has verify "${c.verify}"; use test:<file>, command:<pnpm|node ...> or manual:<who>`);
    }
  }
  return problems;
}

// Schema and reference checks that always hold, whatever an item's status.
export function validateBacklog(bl) {
  const problems = [...bl.parseErrors];
  const ids = new Set(bl.items.keys());
  const decisionIds = new Set(bl.decisions.map((d) => d.id));
  for (const [id, { meta }] of bl.items) {
    if (!/^SL-\d{3}$/.test(id)) problems.push(`${id}: file name must be SL-<three digits>.md`);
    if (meta.id !== id) problems.push(`${id}: id ${meta.id} does not match the file name`);
    if (!meta.title) problems.push(`${id}: missing title`);
    if (!Number.isInteger(meta.phase) || meta.phase < 0 || meta.phase > 10) problems.push(`${id}: phase must be a whole number from 0 to 10`);
    if (!STATUSES.includes(meta.status)) problems.push(`${id}: status "${meta.status}" is not one of ${STATUSES.join(', ')}`);
    if (meta.status === 'legacy-done' && meta.legacy !== true) problems.push(`${id}: legacy-done is only for items closed before the workflow existed (legacy: true)`);
    for (const dep of meta.dependsOn ?? []) {
      if (!ids.has(dep)) problems.push(`${id}: depends on unknown item ${dep}`);
      if (dep === id) problems.push(`${id}: cannot depend on itself`);
    }
    for (const d of meta.decisions ?? []) if (!decisionIds.has(d)) problems.push(`${id}: unknown decision ${d}`);
    for (const g of meta.groups ?? []) if (!bl.groups[g]) problems.push(`${id}: unknown group "${g}"`);
    problems.push(...checkProblems(id, meta.checks));
    if (['ready', 'in-progress', 'done'].includes(meta.status)) {
      if ((meta.groups ?? []).length === 0) problems.push(`${id}: ${meta.status} items need at least one test group`);
      if ((meta.checks ?? []).length === 0) problems.push(`${id}: ${meta.status} items need acceptance checks`);
    }
  }
  for (const d of bl.decisions) {
    if (!['open', 'resolved'].includes(d.status)) problems.push(`${d.id}: status must be open or resolved`);
    if (d.status === 'resolved' && !d.resolution) problems.push(`${d.id}: a resolved decision needs a resolution (a path to its record)`);
  }
  return problems;
}

// No item may become ready while an earlier phase still has unfinished items.
export function phaseGateProblems(item, bl) {
  const open = [...bl.items.values()].filter((o) => o.meta.phase < item.meta.phase && !COMPLETE.includes(o.meta.status));
  if (open.length === 0) return [];
  const byPhase = new Map();
  for (const o of open) byPhase.set(o.meta.phase, [...(byPhase.get(o.meta.phase) ?? []), o.meta.id]);
  return [...byPhase.entries()].map(([p, ids]) => `${item.meta.id}: phase ${p} is still open: ${ids.join(', ')}. Finish the current phase before starting the next.`);
}

export function planProblems(text) {
  const problems = [];
  const sections = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    const h = line.match(/^## (.+?)\s*$/);
    if (h) {
      current = h[1];
      sections.set(current, '');
    } else if (current) sections.set(current, `${sections.get(current)}${line}\n`);
  }
  for (const name of PLAN_SECTIONS) {
    if (!sections.has(name)) problems.push(`plan is missing the "${name}" section`);
    else if (sections.get(name).trim() === '') problems.push(`plan section "${name}" is empty`);
  }
  return problems;
}

export function approvalPath(id, root = ROOT) {
  return join(root, `backlog/approvals/${id}.json`);
}

// Definition of Ready: everything that must be true before implementation starts.
export function readyProblems(item, bl, { root = bl.root } = {}) {
  const { meta } = item;
  const id = meta.id;
  const problems = [];
  for (const dep of meta.dependsOn ?? []) {
    const d = bl.items.get(dep);
    if (d && !COMPLETE.includes(d.meta.status)) problems.push(`${id}: depends on ${dep}, which is not done`);
  }
  problems.push(...phaseGateProblems(item, bl));
  for (const did of meta.decisions ?? []) {
    const d = bl.decisions.find((x) => x.id === did);
    if (d && d.status !== 'resolved') problems.push(`${id}: decision ${did} is still open: ${d.question}`);
  }
  const groups = meta.groups ?? [];
  if (groups.length === 0) problems.push(`${id}: needs at least one test group`);
  for (const g of groups) {
    if (bl.groups[g]?.status === 'pending') problems.push(`${id}: group "${g}" is pending (no tests yet), so it would verify nothing`);
  }
  const checks = meta.checks ?? [];
  if (checks.length === 0) problems.push(`${id}: needs acceptance checks`);
  const testGlobs = groups.flatMap((g) => bl.groups[g]?.testPaths ?? []);
  for (const c of checks) {
    const m = (c.verify ?? '').match(/^test:(.+)$/);
    if (!m) continue;
    if (!existsSync(join(root, m[1]))) problems.push(`${id}: ${c.id}: test file ${m[1]} does not exist`);
    else if (!testGlobs.some((glob) => globToRegExp(glob).test(m[1]))) problems.push(`${id}: ${c.id}: ${m[1]} is not a test of this item's groups`);
  }
  if (meta.legacy === true) return problems; // closed-before-the-workflow items are not asked for a plan or approval
  if (!meta.plan) {
    problems.push(`${id}: needs a plan (docs/plans/${id}.md)`);
    return problems;
  }
  const planFile = join(root, meta.plan);
  if (!existsSync(planFile)) {
    problems.push(`${id}: plan ${meta.plan} does not exist`);
    return problems;
  }
  const planText = readFileSync(planFile, 'utf8');
  problems.push(...planProblems(planText).map((p) => `${id}: ${p}`));
  const approval = approvalPath(id, root);
  if (!existsSync(approval)) problems.push(`${id}: the plan is not approved (the owner runs: pnpm work approve ${id})`);
  else if (JSON.parse(readFileSync(approval, 'utf8')).planSha256 !== sha256(planText)) problems.push(`${id}: the plan changed after it was approved; it needs a new approval`);
  return problems;
}

// `from` is null for a new item. `bootstrap` is true only when the backlog directory is first created.
export function transitionProblems(from, to, { bootstrap = false } = {}) {
  if (from === null) {
    if (to === 'not-started' || bootstrap) return [];
    return [`new item cannot start as ${to}; new items begin as not-started`];
  }
  if (from === to) return [];
  if (to === 'legacy-done') return ['legacy-done cannot be set on an existing item'];
  if ((EDGES[from] ?? []).includes(to)) return [];
  return [`status cannot change from ${from} to ${to}`];
}

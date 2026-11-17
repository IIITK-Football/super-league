// Completion walkthroughs (docs/walkthroughs/SL-xxx.md). `pnpm work done` writes the FACTS (commits, files by test
// group, evidence, acceptance results) between generated markers from machine-captured evidence; the author writes
// the narrative sections. A validator accepts only a complete, current walkthrough, so "done" cannot be claimed in
// prose. Pure functions: nothing here touches the disk.
import { globToRegExp } from '../test-groups.mjs';

export const SECTIONS = [
  'Summary',
  'What changed',
  'Evidence',
  'Acceptance checks',
  'Cross-cutting rules',
  'Hosted actions',
  'Assumptions and deviations',
  'Risks and follow-ups',
  'Rollback',
];
export const GENERATED = ['What changed', 'Evidence', 'Acceptance checks'];
const NARRATIVE = ['Summary', 'Hosted actions', 'Assumptions and deviations', 'Risks and follow-ups', 'Rollback'];
const PROMPTS = {
  Summary: 'what this delivered and why, in plain language.',
  'Hosted actions': 'what was done on hosted systems (staging, production, GitHub settings), or "None".',
  'Assumptions and deviations': 'choices made without asking, and anything that differs from the plan, or "None".',
  'Risks and follow-ups': 'what could still go wrong, and work this leaves for later, or "None".',
  Rollback: 'how to undo this change.',
};

const marker = (name) => ({ start: `<!-- generated:${name} -->`, end: '<!-- /generated -->' });

function groupOfFile(file, groups) {
  const names = Object.entries(groups)
    .filter(([, g]) => [...(g.paths ?? []), ...(g.covers ?? []), ...(g.testPaths ?? [])].some((p) => globToRegExp(p).test(file)))
    .map(([n]) => n);
  return names[0] ?? 'other';
}

function renderWhatChanged({ commits, files, bl }) {
  const byGroup = {};
  for (const f of files) byGroup[groupOfFile(f, bl.groups)] = (byGroup[groupOfFile(f, bl.groups)] ?? 0) + 1;
  return [
    `Commits (${commits.length}):`,
    '',
    ...commits.map((c) => `- ${c.sha.slice(0, 7)} ${c.subject}`),
    '',
    `Files changed: ${files.length}`,
    '',
    '| Test group | Files |',
    '|---|---|',
    ...Object.entries(byGroup).sort().map(([g, n]) => `| ${g} | ${n} |`),
  ].join('\n');
}

function renderEvidence({ evidence }) {
  return [
    `head: ${evidence.head}`,
    `tree: ${evidence.tree}`,
    `clean: ${evidence.clean}`,
    `recorded: ${evidence.at ?? 'unknown'}`,
    '',
    '| Group | Command | Exit | Result |',
    '|---|---|---|---|',
    ...evidence.groups.flatMap((g) =>
      (g.commands?.length ? g.commands : [{ cmd: '(no command)', exit: '' }]).map((c) => `| ${g.name} | \`${c.cmd}\` | ${c.exit} | ${g.state} |`),
    ),
  ].join('\n');
}

export function checkResult(check, { evidence, attestations = [] }) {
  const kind = check.verify.split(':')[0];
  if (kind === 'test') return evidence.groups.every((g) => g.state === 'passed') ? 'PASS' : 'FAIL';
  if (kind === 'command') {
    const r = evidence.commandChecks?.[check.id];
    return r === undefined ? 'NOT RUN' : r.exit === 0 ? 'PASS' : 'FAIL';
  }
  const a = attestations.find((x) => x.checkId === check.id);
  return a ? `ATTESTED by ${a.by} on ${String(a.at).slice(0, 10)}` : 'NOT ATTESTED';
}

function renderChecks(ctx) {
  return [
    '| Check | What it verifies | Verification | Result |',
    '|---|---|---|---|',
    ...(ctx.item.meta.checks ?? []).map((c) => `| ${c.id} | ${c.text} | \`${c.verify}\` | ${checkResult(c, ctx)} |`),
  ].join('\n');
}

const RENDER = { 'What changed': renderWhatChanged, Evidence: renderEvidence, 'Acceptance checks': renderChecks };
const block = (name, ctx) => `${marker(name).start}\n${RENDER[name](ctx)}\n${marker(name).end}`;

export function buildSkeleton(ctx) {
  const m = ctx.item.meta;
  const lines = [`# Walkthrough: ${m.id} ${m.title}`, '', 'Facts between the generated markers are written by `pnpm work done`; do not edit them. Fill in every other section.', ''];
  for (const s of SECTIONS) {
    lines.push(`## ${s}`, '');
    if (GENERATED.includes(s)) lines.push(block(s, ctx));
    else if (s === 'Cross-cutting rules') {
      lines.push('Each rule is `pass`, or `n/a: <reason>`.', '');
      for (const r of ctx.bl.rules) lines.push(`- ${r.id}: TODO (${r.text})`);
    } else lines.push(`TODO: ${PROMPTS[s]}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

// Rewrites only the generated blocks; everything the author wrote is kept.
export function refreshGenerated(text, ctx) {
  let out = text;
  for (const name of GENERATED) {
    const { start, end } = marker(name);
    const a = out.indexOf(start);
    const b = a >= 0 ? out.indexOf(end, a) : -1;
    if (a >= 0 && b >= 0) out = out.slice(0, a) + block(name, ctx) + out.slice(b + end.length);
  }
  return out;
}

function sectionsOf(text) {
  const map = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    const h = line.match(/^## (.+?)\s*$/);
    if (h) {
      current = h[1];
      map.set(current, '');
    } else if (current) map.set(current, `${map.get(current)}${line}\n`);
  }
  return map;
}

export function walkthroughProblems(text, ctx) {
  const problems = [];
  const sections = sectionsOf(text);
  for (const s of SECTIONS) if (!sections.has(s)) problems.push(`the walkthrough is missing the "${s}" section`);
  if (problems.length) return problems;

  for (const s of NARRATIVE) {
    const body = sections.get(s).replace(/<!--[\s\S]*?-->/g, '').trim();
    if (body === '') problems.push(`"${s}" is empty`);
    else if (/\bTODO\b/.test(body)) problems.push(`"${s}" still contains TODO`);
  }

  const rulesText = sections.get('Cross-cutting rules');
  for (const r of ctx.bl.rules) {
    const line = rulesText.split('\n').find((l) => l.startsWith(`- ${r.id}:`));
    if (!line) {
      problems.push(`rule ${r.id} is missing from "Cross-cutting rules"`);
      continue;
    }
    const value = line.slice(`- ${r.id}:`.length).trim();
    if (/\bTODO\b/.test(value)) problems.push(`${r.id}: still contains TODO`);
    else if (value === 'pass') continue;
    else if (value === 'n/a' || (value.startsWith('n/a:') && value.slice(4).trim().length < 3)) problems.push(`${r.id}: n/a needs a reason (n/a: why it does not apply)`);
    else if (!value.startsWith('n/a:')) problems.push(`${r.id}: write "pass" or "n/a: <reason>"`);
  }

  const evidenceText = sections.get('Evidence');
  if (!evidenceText.includes(`head: ${ctx.evidence.head}`)) problems.push('the walkthrough is stale: it records different evidence than backlog/evidence; run `pnpm work done` again');

  const checksText = sections.get('Acceptance checks');
  for (const c of ctx.item.meta.checks ?? []) {
    if (!checksText.includes(`| ${c.id} |`)) {
      problems.push(`${c.id} is missing from "Acceptance checks"`);
      continue;
    }
    const result = checkResult(c, ctx);
    if (result === 'FAIL') problems.push(`${c.id}: the check failed`);
    else if (result === 'NOT RUN') problems.push(`${c.id}: the command check was not run`);
    else if (result === 'NOT ATTESTED') problems.push(`${c.id}: manual check not attested (the owner runs: pnpm work attest ${ctx.item.meta.id} ${c.id})`);
  }
  return problems;
}

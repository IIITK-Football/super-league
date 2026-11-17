// Pure helpers for the commit-time hooks (SL-015). No hook here edits files or creates commits.
export const TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];

// strict = judging what may be PUBLISHED: work-in-progress commits (fixup!, squash!, amend!, WIP) must be tidied first.
// The local commit-msg hook is not strict so rebasing with fixup commits still works.
// The repository history shows the owner as the only author: no AI co-author trailers and no "generated with" lines.
// A message that merely MENTIONS the tool (for example "add a Claude Code guard") is fine.
export const AI_NAME = /claude|anthropic/i;
function attributionErrors(raw) {
  const errors = [];
  for (const l of raw.split('\n')) {
    if (/^\s*co-authored-by:/i.test(l) && AI_NAME.test(l)) errors.push('Remove the AI co-author trailer: commits carry no AI attribution (the owner is the only author).');
    if (/^\W*generated (?:with|by)\b/i.test(l) && AI_NAME.test(l)) errors.push('Remove the "generated with" line: commits carry no AI attribution (the owner is the only author).');
  }
  return [...new Set(errors)];
}

export function validateCommitMessage(raw, { strict = false } = {}) {
  const attribution = attributionErrors(raw);
  if (attribution.length) return { ok: false, errors: attribution, hints: [] };
  const lines = raw.split('\n').filter((l) => !l.startsWith('#'));
  const first = (lines.find((l) => l.trim() !== '') ?? '').trim();
  const errors = [];
  const hints = [];

  if (strict && /^(fixup! |squash! |amend! |wip\b)/i.test(first)) {
    return { ok: false, errors: ['Work-in-progress commits (fixup!, squash!, amend!, WIP) must be tidied before publishing: squash or reword them.'], hints };
  }
  if (/^(Merge |Revert "|fixup! |squash! |amend! )/.test(first)) return { ok: true, errors, hints };

  const m = first.match(/^([a-z]+)(\([a-z0-9._/-]+\))?(!)?: (.+)$/);
  if (!m) {
    errors.push(
      `First line must follow Conventional Commits: type(scope): subject — e.g. "feat(auth): support password login for Google accounts". ` +
        `Types: ${TYPES.join(', ')}.`,
    );
  } else {
    if (!TYPES.includes(m[1])) errors.push(`Unknown type "${m[1]}". Use one of: ${TYPES.join(', ')}.`);
    if (!m[4].trim()) errors.push('Subject is empty.');
  }
  if (first.length > 72) errors.push(`First line is ${first.length} characters; keep it to 72 or fewer.`);
  // Backlog numbers live in the backlog file only, never in commit messages.
  if (/\bSL-\d+\b/i.test(raw) || /\bbacklog item\b/i.test(raw)) {
    errors.push('Remove backlog references (SL-numbers, "Backlog item") and describe the change in plain language.');
  }
  return { ok: errors.length === 0, errors, hints };
}

export function checkStagedFiles(files) {
  const problems = [];
  for (const f of files) {
    const base = f.split('/').pop();
    if (/^\.env(\..+)?$/.test(base) && base !== '.env.example') {
      problems.push(`${f}: environment files must not be committed (only .env.example).`);
    } else if (/\.(pem|key|p12|pfx)$/.test(base) || /^id_(rsa|dsa|ecdsa|ed25519)$/.test(base)) {
      problems.push(`${f}: looks like a private key or credential file.`);
    }
  }
  return problems;
}

const SECRET_PATTERNS = [
  ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{16,}/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['JWT-like token', /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
  ['AWS-style access key id', /\bAKIA[0-9A-Z]{16}\b/],
];

// Reports file, line and pattern name only; never the matched value.
export function scanAddedLines(diffText) {
  const findings = [];
  let file = '';
  let line = 0;
  for (const l of diffText.split('\n')) {
    if (l.startsWith('+++ ')) {
      file = l.replace(/^\+\+\+ b\//, '');
      continue;
    }
    const hunk = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) {
      line = Number(hunk[1]) - 1;
      continue;
    }
    if (l.startsWith('+') && !l.startsWith('+++')) {
      line += 1;
      for (const [name, re] of SECRET_PATTERNS) {
        if (re.test(l)) findings.push({ file, line, pattern: name });
      }
    } else if (!l.startsWith('-')) {
      line += 1;
    }
  }
  return findings;
}

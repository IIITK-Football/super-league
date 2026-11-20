// Group: tooling. CODEOWNERS (D-10): with GitHub's last-match-wins rule, the repository owner owns every path; the
// backend owner is added on backend and API Worker files, the frontend owner on frontend files; gate-defining files,
// workflows and root shared files stay owner-only; every owner listed is a known handle.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const lines = readFileSync(join(__dirname, '../../../.github/CODEOWNERS'), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  .map((l) => { const [pattern, ...owners] = l.split(/\s+/); return { pattern, owners }; });

// GitHub semantics for the patterns used here: "*" matches everything; "/dir/" matches everything under dir.
function ownersOf(path: string): string[] {
  let owners: string[] = [];
  for (const { pattern, owners: o } of lines) {
    const match = pattern === '*' || (pattern.startsWith('/') && pattern.endsWith('/') && `/${path}`.startsWith(pattern));
    if (match) owners = o;
  }
  return owners;
}

const OWNER = '@kevinmatheuu';
const BACKEND = '@ebinthomas06';
const FRONTEND = '@AbhiKamp';

describe('CODEOWNERS', () => {
  it('lists only the three agreed handles, with the owner on every line', () => {
    for (const { owners } of lines) {
      expect(owners).toContain(OWNER);
      for (const o of owners) expect([OWNER, BACKEND, FRONTEND]).toContain(o);
    }
  });

  it.each([
    ['backend/app/api/news/route.ts', [OWNER, BACKEND]],
    ['backend/supabase/migrations/20261203000000_security_hardening.sql', [OWNER, BACKEND]],
    ['api/src/app.ts', [OWNER, BACKEND]],
    ['frontend/src/pages/Home.jsx', [OWNER, FRONTEND]],
    ['frontend/functions/api/[[path]].js', [OWNER, FRONTEND]],
  ])('%s is owned by %j', (path, expected) => {
    expect(ownersOf(path)).toEqual(expected);
  });

  it.each([
    'package.json', 'tests/groups.json', 'docs/process/workflow.md', 'backlog/rules.json', 'scripts/work/cli.mjs',
    'backend/tests/tooling/claude-guard.test.ts', 'api/scripts/deploy-production.mjs', '.github/workflows/ci.yml',
    '.claude/settings.json', '.githooks/pre-push', 'CLAUDE.md',
  ])('%s stays owner-only', (path) => {
    expect(ownersOf(path)).toEqual([OWNER]);
  });
});

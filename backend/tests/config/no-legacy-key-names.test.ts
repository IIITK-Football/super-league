// Group: config. The deprecated Supabase key variable names must not creep back into the repository.
// Only the places that mention them ON PURPOSE are allowed: the rename messages, the tests that
// check them, and the migration notes.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = join(__dirname, '../../..');
const LEGACY = /SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|VITE_SUPABASE_ANON_KEY/;

const ALLOWED = new Set([
  'frontend/src/lib/env.js', // reports old names as renamed
  'backend/tests/config/supabase-keys.test.ts',
  'backend/tests/config/supabase-key-usage.test.ts',
  'backend/tests/config/no-legacy-key-names.test.ts',
  'frontend/src/lib/__tests__/env.test.js',
  'frontend/src/lib/__tests__/pagesMiddleware.test.js',
  'frontend/src/lib/__tests__/bundleGuard.test.js',
  'docs/environment.md', // migration notes
  'docs/supabase-key-usage.md',
  'docs/local-development.md',
]);

function trackedTextFiles(): string[] {
  const r = spawnSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8' });
  expect(r.status).toBe(0);
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx|js|jsx|mjs|json|md|toml|yml|yaml|sql|sh|example)$|\.example$|\.env\.example$/.test(f))
    .filter((f) => !/pnpm-lock\.yaml$|migrations_legacy\//.test(f));
}

describe('deprecated Supabase key names', () => {
  it('appear only in the allow-listed files', () => {
    const offenders = trackedTextFiles()
      .filter((f) => !ALLOWED.has(f))
      .filter((f) => {
        try {
          return LEGACY.test(readFileSync(join(repo, f), 'utf8'));
        } catch {
          return false; // deleted but still listed
        }
      });
    expect(offenders, 'Use SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY (see docs/environment.md)').toEqual([]);
  });

  it('every allow-listed file still needs its entry', () => {
    const tracked = new Set(trackedTextFiles());
    const stale = [...ALLOWED].filter((f) => tracked.has(f)).filter((f) => !LEGACY.test(readFileSync(join(repo, f), 'utf8')));
    expect(stale, 'Remove files from ALLOWED that no longer mention the old names').toEqual([]);
  });
});

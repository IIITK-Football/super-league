// Group: config. Where each Supabase key may be used. The secret key bypasses RLS, so every file
// that uses it is listed here on purpose: adding one means adding it to this list (and to
// docs/supabase-key-usage.md) in the same change, with a reason.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const backend = join(__dirname, '../..');
const repo = join(backend, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', 'dist', '.git'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const serverSources = [...walk(join(backend, 'app')), ...walk(join(backend, 'lib')), join(backend, 'middleware.ts')].filter(
  (p) => !/lib\/(supabase\/keys|env)\.ts$/.test(p),
);
const rel = (p: string) => relative(backend, p).split('\\').join('/');
const read = (p: string) => readFileSync(p, 'utf8');

// Files that genuinely use the secret key, with why. Reasons are summarised in docs/supabase-key-usage.md.
const ELEVATED: Record<string, string> = {
  // Server-to-server jobs protected by CRON_SECRET: no user context
  'app/api/wc/sync/groups/route.ts': 'cron sync',
  'app/api/wc/sync/matches/route.ts': 'cron sync',
  'app/api/wc/sync/players/route.ts': 'cron sync',
  'app/api/wc/sync/single/route.ts': 'cron sync',
  'app/api/wc/sync/teams/route.ts': 'cron sync',
  'app/api/wc/grade/awards/route.ts': 'cron grading',
  'app/api/wc/grade/champion/route.ts': 'cron grading',
  'app/api/wc/grade/finals/route.ts': 'cron grading',
  'app/api/wc/grade/groups/route.ts': 'cron grading',
  'app/api/wc/grade/quarter-finals/route.ts': 'cron grading',
  'app/api/wc/grade/round-of-16/route.ts': 'cron grading',
  'app/api/wc/grade/semi-finals/route.ts': 'cron grading',
  // Admin grading writes other users' rows
  'app/api/admin/predictions/grade/route.ts': 'admin grading',
  'app/api/admin/predictions/regrade-all/route.ts': 'admin grading',
  // Role-checked writes: to be replaced by RLS and role policies in the authorization work
  'app/api/admin/team-registrations/route.ts': 'role-checked write (to downscope)',
  'app/api/captain/team-branding/route.ts': 'role-checked write (to downscope)',
  'app/api/players/route.ts': 'role-checked write (to downscope)',
  'app/api/players/[player_id]/route.ts': 'role-checked write (to downscope)',
  // User-facing routes that use the elevated key today (candidates to downscope; see audit notes)
  'app/api/leaderboard/route.ts': 'to downscope',
  'app/api/wc/leaderboard/route.ts': 'to downscope',
  'app/api/wc/teams/route.ts': 'to downscope',
  'app/api/wc/players/route.ts': 'to downscope',
  'app/api/wc/champion-predictors/route.ts': 'to downscope',
  'app/api/wc/flair/route.ts': 'to downscope; trusts a client user_id',
  'app/api/wc/predictions/awards/route.ts': 'to downscope',
  'app/api/wc/predictions/groups/route.ts': 'to downscope; trusts a client user_id',
  'app/api/wc/predictions/knockouts/route.ts': 'to downscope',
  'app/api/wc/predictions/knockouts/submit/route.ts': 'to downscope; trusts a client user_id',
  // Unauthenticated today: must gain authentication in the authorization work
  'app/api/wc/sync/brazil/route.ts': 'UNAUTHENTICATED; to fix',
  'app/api/wc/sync/manual/route.ts': 'UNAUTHENTICATED; to fix',
};

describe('Supabase key usage (backend)', () => {
  it('no source still reads the legacy key variable names', () => {
    const offenders = serverSources.filter((p) => /SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY/.test(read(p))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('only the listed files use the secret key', () => {
    const users = serverSources.filter((p) => /secretKey\(\)|SUPABASE_SECRET_KEY/.test(read(p))).map(rel).sort();
    const listed = Object.keys(ELEVATED).sort();
    const unlisted = users.filter((f) => !listed.includes(f));
    const stale = listed.filter((f) => !users.includes(f));
    expect(unlisted, `New elevated-key usage: add it to ELEVATED with a reason and to docs/supabase-key-usage.md`).toEqual([]);
    expect(stale, 'Listed but no longer using the secret key: remove it from ELEVATED').toEqual([]);
  });

  it('middleware and shared lib code never use the secret key', () => {
    const offenders = serverSources.filter((p) => /middleware\.ts$|\/lib\//.test(rel(p)) || rel(p) === 'middleware.ts')
      .filter((p) => /secretKey\(\)|SUPABASE_SECRET_KEY/.test(read(p))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('nothing exposes a Supabase key through a NEXT_PUBLIC_ name', () => {
    const offenders = serverSources.filter((p) => /NEXT_PUBLIC_SUPABASE_(SECRET|SERVICE)/.test(read(p))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('every elevated route is a server route handler, never a client component', () => {
    for (const file of Object.keys(ELEVATED)) {
      expect(file).toMatch(/^app\/api\/.*\/route\.ts$/);
      expect(read(join(backend, file))).not.toMatch(/^['"]use client['"]/m);
    }
  });
});

describe('Supabase key usage (frontend bundle and Pages Functions)', () => {
  const frontendSources = [...walk(join(repo, 'frontend/src')), ...walk(join(repo, 'frontend/functions'))];

  it('contains no elevated key name or value format', () => {
    const offenders = frontendSources
      .filter((p) => !/__tests__/.test(p))
      .filter((p) => !/frontend\/src\/lib\/env\.js$/.test(p)) // the guard that rejects these names
      .filter((p) => /SUPABASE_SECRET_KEY|SERVICE_ROLE|sb_secret_|secretKey/.test(read(p)))
      .map((p) => relative(repo, p));
    expect(offenders).toEqual([]);
  });
});

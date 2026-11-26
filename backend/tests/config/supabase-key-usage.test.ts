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
  (p) => !/lib\/(supabase\/keys|supabase\/clients|env)\.ts$/.test(p),
);
const rel = (p: string) => relative(backend, p).split('\\').join('/');
const read = (p: string) => readFileSync(p, 'utf8');
// A file is elevated when it builds the secret-key client (jobClient) or reads the secret key itself.
const ELEVATED_USE = /jobClient\b|secretKey\(\)|SUPABASE_SECRET_KEY/;

// Files that genuinely use the secret key, with why. Reasons are summarised in docs/supabase-key-usage.md.
const ELEVATED: Record<string, string> = {
  // Admin grading writes other users' rows
  'app/api/admin/predictions/grade/route.ts': 'admin grading',
  'app/api/admin/predictions/regrade-all/route.ts': 'admin grading',
  // World Cup archive reads (frozen, D-02) of tables with no public read policy: owner-approved exceptions to the D-04
  // allowlist (2026-11-26). Read-only; their submissions are closed and no longer write.
  'app/api/wc/leaderboard/route.ts': 'archive read, no public policy on wc_leaderboard',
  'app/api/wc/players/route.ts': 'archive read, no public policy on wc_players',
  'app/api/wc/predictions/awards/route.ts': 'archive read, no public policy on wc_award_predictions',
  'app/api/wc/predictions/groups/route.ts': 'archive read, no public policy on wc_group_predictions',
};

describe('Supabase key usage (backend)', () => {
  it('no source still reads the legacy key variable names', () => {
    const offenders = serverSources.filter((p) => /SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY/.test(read(p))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('only the listed files use the secret key', () => {
    const users = serverSources.filter((p) => ELEVATED_USE.test(read(p))).map(rel).sort();
    const listed = Object.keys(ELEVATED).sort();
    const unlisted = users.filter((f) => !listed.includes(f));
    const stale = listed.filter((f) => !users.includes(f));
    expect(unlisted, `New elevated-key usage: add it to ELEVATED with a reason and to docs/supabase-key-usage.md`).toEqual([]);
    expect(stale, 'Listed but no longer using the secret key: remove it from ELEVATED').toEqual([]);
  });

  it('middleware and shared lib code never use the secret key', () => {
    const offenders = serverSources.filter((p) => /middleware\.ts$|\/lib\//.test(rel(p)) || rel(p) === 'middleware.ts')
      .filter((p) => ELEVATED_USE.test(read(p))).map(rel);
    expect(offenders).toEqual([]);
  });

  // D-04: the factories in lib/supabase/clients.ts are the only place a client is built and the only reader of the
  // secret key, so every Data API call has the transport timeouts and Server-Timing accounting.
  it('only the client factories read the secret key', () => {
    const offenders = serverSources.filter((p) => /secretKey\(\)/.test(read(p))).map(rel);
    expect(offenders).toEqual([]);
    expect(read(join(backend, 'lib/supabase/clients.ts'))).toMatch(/secretKey\(\)/);
  });

  it('handlers served by the Worker build every client through the factories', () => {
    const routeTable = read(join(repo, 'api/src/routes.ts'));
    const served = [...routeTable.matchAll(/'\.\.\/\.\.\/backend\/(app\/api\/[^']+)'/g)].map((m) => `${m[1]}.ts`);
    expect(served.length).toBeGreaterThan(20);
    const direct = [...served, 'lib/roster/access.ts', 'lib/scope.ts']
      .filter((f) => /\bcreate(Server)?Client\(/.test(read(join(backend, f))));
    expect(direct).toEqual([]);
    expect(read(join(repo, 'api/src/app.ts'))).not.toMatch(/\bcreateClient\(/);
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

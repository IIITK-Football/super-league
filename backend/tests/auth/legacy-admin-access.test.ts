// Group: auth-identity. The legacy stored role 'admin' grants nothing (SL-003): no backend route or helper may list it
// as an accepted role. Account rows still holding it are mapped by a reviewed per-person step, not by code. The World
// Cup routes are a separate workstream and are checked there. The database side is pinned by
// supabase/tests/database/011_legacy_admin.test.sql.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const backend = join(__dirname, '../..');
const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return name === 'wc' || name === 'node_modules' ? [] : files(path);
  return /\.(ts|tsx|js)$/.test(name) ? [path] : [];
});

describe('the legacy admin role grants nothing in the backend', () => {
  it('no route or helper accepts the stored role admin', () => {
    const offenders = [...files(join(backend, 'app/api')), ...files(join(backend, 'lib'))]
      .filter((f) => /(["'`])admin\1/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(backend, f));
    expect(offenders).toEqual([]);
  });

  it('the scan covers the routes that used to accept it', () => {
    const scanned = files(join(backend, 'app/api')).map((f) => relative(backend, f));
    for (const route of ['app/api/admin/matches/live/route.ts', 'app/api/captain/team-branding/route.ts',
      'app/api/admin/newsletter/route.ts', 'app/api/admin/newsletter/image/route.ts']) {
      expect(scanned).toContain(route);
    }
  });
});

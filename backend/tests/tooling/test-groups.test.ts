// Group: tooling. Test-group selection logic (scripts/test-groups.mjs).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { affectedGroups, globToRegExp, loadGroups, needsLocalDatabase, validateGroups } from '../../../scripts/test-groups.mjs';

const root = join(__dirname, '../../..');
const config = loadGroups(join(root, 'tests/groups.json'));

describe('globToRegExp', () => {
  it('treats * as one segment and ** as many', () => {
    expect(globToRegExp('backend/supabase/**').test('backend/supabase/seed.sql')).toBe(true);
    expect(globToRegExp('backend/supabase/**').test('backend/supabase/tests/database/a.sql')).toBe(true);
    expect(globToRegExp('scripts/*.sh').test('scripts/a/b.sh')).toBe(false);
    expect(globToRegExp('**/.env.example').test('backend/.env.example')).toBe(true);
    expect(globToRegExp('**/.env.example').test('.env.example')).toBe(true);
  });
});

describe('affectedGroups', () => {
  it('selects only groups whose paths match', () => {
    const g = affectedGroups(['backend/supabase/seed.sql'], config);
    expect(g).toContain('database');
    expect(g).not.toContain('frontend-components');
  });

  it('maps frontend source to frontend-components', () => {
    expect(affectedGroups(['frontend/src/pages/Home.jsx'], config)).toEqual(['frontend-components']);
  });

  it('runs nothing for docs-only changes', () => {
    expect(affectedGroups(['docs/local-seed.md', 'README.md'], config)).toEqual([]);
  });

  it('selects every non-scheduled group when dependencies change', () => {
    const g = affectedGroups(['frontend/pnpm-lock.yaml'], config);
    expect(g).toContain('database');
    expect(g).toContain('frontend-components');
    expect(g).not.toContain('e2e');
  });

  it('excludes scheduled-only groups from change-based selection', () => {
    expect(affectedGroups(['frontend/src/App.jsx'], config)).not.toContain('e2e');
    expect(affectedGroups([], config, { all: true })).toContain('e2e');
  });
});

describe('needsLocalDatabase', () => {
  it('is true when any selected group needs the local database', () => {
    expect(needsLocalDatabase(['database'], config)).toBe(true);
    expect(needsLocalDatabase(['config', 'auth-identity'], config)).toBe(true);
  });

  it('is false when none do', () => {
    expect(needsLocalDatabase(['config', 'frontend-components'], config)).toBe(false);
    expect(needsLocalDatabase([], config)).toBe(false);
  });

  it('follows the auth files into a database-backed group', () => {
    const groups = affectedGroups(['backend/lib/auth/collegeEmail.ts'], config);
    expect(groups).toContain('auth-identity');
    expect(needsLocalDatabase(groups, config)).toBe(true);
  });
});

describe('groups.json', () => {
  it('is valid: owners, descriptions, paths, existing cwd', () => {
    expect(validateGroups(config, root)).toEqual([]);
  });

  it('defines the required domain groups', () => {
    for (const name of ['database', 'auth-roles', 'api-services', 'match-operations', 'fantasy', 'frontend-components', 'e2e']) {
      expect(config.groups[name]).toBeDefined();
    }
  });

  it('only marks groups pending when they have no runnable tests', () => {
    for (const [name, g] of Object.entries<any>(config.groups)) {
      if (g.status === 'pending') {
        expect(g.run, name).toEqual([]);
        expect(g.pendingFor, name).toBeTruthy();
      } else {
        expect(g.run.length, name).toBeGreaterThan(0);
      }
    }
    expect(existsSync(join(root, 'scripts/test-groups.mjs'))).toBe(true);
  });

  it('runs the API Worker tests for Worker and shared handler changes, against the local stack', () => {
    expect(config.groups['api-services'].status).toBeUndefined();
    expect(affectedGroups(['api/src/app.ts'], config)).toContain('api-services');
    expect(affectedGroups(['backend/app/api/news/route.ts'], config)).toContain('api-services');
    expect(affectedGroups(['backend/lib/storage.ts'], config)).toContain('api-services');
    expect(config.groups['api-services'].covers).toContain('backend/lib/storage.ts');
    expect(needsLocalDatabase(['api-services'], config)).toBe(true);
    const workspace = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace).toMatch(/^\s+- api$/m);
  });
});

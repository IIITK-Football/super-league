// Group: auth-roles. No runtime code reads a retired role surface: the registration table, the single-role helpers,
// a stored default or admin role, or one role row per person. A normal user holds no grant, and roles are read through
// my_roles() and the scoped helpers. The scan covers backend and frontend source (not migrations, which are history,
// and not tests that assert the surfaces are gone).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../../..');
const skip = new Set(['node_modules', '.next', 'dist', 'migrations', 'migrations_legacy', '__tests__', 'tests', '.git']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (skip.has(name)) return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(name) ? [full] : [];
  });
}

const source = [join(root, 'backend/app'), join(root, 'backend/lib'), join(root, 'frontend/src')].flatMap(files);
const offenders = (pattern: RegExp) => source.filter((f) => pattern.test(readFileSync(f, 'utf8'))).map((f) => relative(root, f));

describe('retired role surfaces', () => {
  it('scans real source', () => {
    expect(source.length).toBeGreaterThan(50);
  });

  it('no code reads the retired registration table, its route or its screen', () => {
    // AuditHistory lists the old table name so earlier history stays filterable; nothing queries it.
    expect(offenders(/from\(['"]team_registrations['"]\)|team-registrations|ManageRegistrations/)).toEqual([]);
  });

  it('no code calls the removed single-role helpers', () => {
    expect(offenders(/is_role_manager|get_user_role/)).toEqual([]);
  });

  it('no code reads one role row per person or treats a stored default or admin value as a role', () => {
    expect(offenders(/from\(['"]user_roles['"]\)\s*\.select\(['"]role['"]\)[^;]*\.(maybeSingle|single)\(/s)).toEqual([]);
    expect(offenders(/role\s*===?\s*['"]default['"]|role:\s*['"]default['"]/)).toEqual([]);
  });

  it('roles are read through the caller\'s own grants only', () => {
    // The only direct reads of user_roles are the dictator's grant screen (insert and delete) and the role directory.
    const direct = offenders(/from\(['"]user_roles['"]\)/);
    expect(direct).toEqual(['frontend/src/components/admin/ManageRoles.jsx']);
  });
});

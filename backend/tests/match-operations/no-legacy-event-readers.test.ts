// Group: match-operations. No runtime code reads or writes a retired event store: the goals table, the matches JSON
// columns (scorers, assists, own_goals), the assists snapshot or the retired /api/matches/update route. The scan covers
// backend and frontend source (not migrations, which are history, and not tests that assert the surfaces are gone).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
const offenders = (pattern: RegExp, except: RegExp[] = []) =>
  source.filter((f) => !f.includes('/api/wc/') && pattern.test(readFileSync(f, 'utf8')) && !except.some((e) => e.test(f))).map((f) => relative(root, f));

describe('retired match event stores', () => {
  it('scans real source', () => expect(source.length).toBeGreaterThan(50));
  it('no code queries the goals table or its columns', () => {
    expect(offenders(/from\(['"]goals['"]\)|goals!|goals\s*\(\s*player_id/)).toEqual([]);
  });
  it('no code reads or writes the matches JSON event columns or the assists snapshot', () => {
    expect(offenders(/legacy_player_assist_counts|\.own_goals\b|match\.scorers|match\.assists|updatePayload\.(scorers|assists|own_goals)|select\([^)]*\bown_goals\b/)).toEqual([]);
  });
  it('the manual score route is gone and nothing posts to it', () => {
    expect(existsSync(join(root, 'backend/app/api/matches/update'))).toBe(false);
    expect(offenders(/matches\/update/)).toEqual([]);
  });
  it('no code writes a score column directly (the score follows the events)', () => {
    expect(offenders(/\.update\(\s*\{[^}]*\b(home_score|away_score)\b/)).toEqual([]);
  });
});

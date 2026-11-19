// Group: tooling. A player's account link (players.user_id) is written only by the database's dictator functions, which
// a trigger enforces on every path. No backend route or helper may write it, and nothing may read every column of
// players (the link column is not readable by visitors or signed-in users, so select('*') would fail for them).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../../..');
const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return name === 'node_modules' || name === '__tests__' ? [] : files(path);
  return /\.(ts|tsx|js|jsx|mjs)$/.test(name) ? [path] : [];
});
const sources = [join(root, 'backend/app'), join(root, 'backend/lib'), join(root, 'frontend/src')].flatMap(files);

describe('player account link', () => {
  it('no route, helper or page writes players.user_id', () => {
    const offenders = sources.filter((f) => {
      const text = readFileSync(f, 'utf8');
      return /from\(['"]players['"]\)[\s\S]{0,200}\.(update|insert|upsert)\([^)]*user_id/.test(text);
    }).map((f) => relative(root, f));
    expect(offenders).toEqual([]);
  });

  it('nothing reads every column of players', () => {
    const offenders = sources.filter((f) => /from\(['"]players['"]\)\s*\.select\(\s*['"]\*['"]/.test(readFileSync(f, 'utf8'))).map((f) => relative(root, f));
    expect(offenders).toEqual([]);
  });
});

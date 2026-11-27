// Group: tooling. CI and contributors install the Node version in .nvmrc. It must satisfy the Node floor that
// every installed dependency declares, so a dependency upgrade can never pass on a developer's newer Node and then
// fail in CI (this happened: jsdom pulls in undici 8, which needs Node >= 22.19).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = join(__dirname, '../../..');
const nvmrcMajor = Number(readFileSync(join(repo, '.nvmrc'), 'utf8').trim().replace(/^v/, '').split('.')[0]);
const rootPkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));

// Lowest Node major a package allows (for "a || b", the lowest alternative). null when it declares nothing.
function lowestMajor(range: string | undefined): number | null {
  if (!range) return null;
  const mins = range
    .split('||')
    .map((part) => part.match(/(?:>=|\^|~)?\s*v?(\d+)(?:\.\d+)*/)?.[1])
    .filter(Boolean)
    .map(Number);
  return mins.length ? Math.min(...mins) : null;
}

function installedFloors(workspace: string): { name: string; floor: number; range: string }[] {
  const store = join(repo, workspace, 'node_modules/.pnpm');
  if (!existsSync(store)) return [];
  const out: { name: string; floor: number; range: string }[] = [];
  for (const dir of readdirSync(store)) {
    if (!/^(undici|jsdom|vitest|vite|@supabase\+supabase-js|wrangler)@/.test(dir)) continue;
    const pkgName = dir.startsWith('@') ? dir.replace('+', '/').replace(/@[^@]+$/, '') : dir.replace(/@[^@]+$/, '');
    const pkgPath = join(store, dir, 'node_modules', pkgName, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const range = JSON.parse(readFileSync(pkgPath, 'utf8')).engines?.node as string | undefined;
    const floor = lowestMajor(range);
    if (floor !== null) out.push({ name: dir, floor, range: range! });
  }
  return out;
}

describe('Node version', () => {
  it('.nvmrc is a plain major version', () => {
    expect(Number.isInteger(nvmrcMajor)).toBe(true);
  });

  it('the root engines floor is not lower than .nvmrc requires', () => {
    expect(lowestMajor(rootPkg.engines?.node)).toBeGreaterThanOrEqual(nvmrcMajor);
  });

  it.each(['frontend', 'backend', 'api'])('.nvmrc satisfies the Node floor of the installed %s dependencies', (workspace) => {
    const tooLow = installedFloors(workspace).filter((p) => p.floor > nvmrcMajor);
    expect(tooLow.map((p) => `${p.name} needs node ${p.range}`)).toEqual([]);
  });
});

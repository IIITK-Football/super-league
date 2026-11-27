// Group: tooling. One package manager and current actions everywhere: the pnpm settings live where pnpm 11 and later
// read them, and no workflow falls back to an action major that runs on a retired runtime.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = join(__dirname, '../../..');
const read = (file: string) => readFileSync(join(repo, file), 'utf8');
const MAJORS: Record<string, string> = { 'actions/checkout': 'v7', 'actions/setup-node': 'v7', 'pnpm/action-setup': 'v6' };

describe('toolchain versions', () => {
  it('every workflow uses the current action majors', () => {
    const uses = readdirSync(join(repo, '.github/workflows'))
      .flatMap((file) => [...read(`.github/workflows/${file}`).matchAll(/uses:\s*([\w-]+\/[\w-]+)@(\S+)/g)]);
    expect(uses.length).toBeGreaterThan(5);
    const stale = uses.filter(([, action, version]) => MAJORS[action] !== version).map(([line]) => line);
    expect(stale).toEqual([]);
  });

  it('pnpm settings are in the workspace file, and each package keeps its own lockfile', () => {
    expect(JSON.parse(read('package.json')).packageManager).toMatch(/^pnpm@12\./);
    expect(read('pnpm-workspace.yaml')).toMatch(/^sharedWorkspaceLockfile: false$/m);
    expect(existsSync(join(repo, '.npmrc'))).toBe(false);
    // Install scripts run only for the packages listed here, and no release-age exception is committed.
    expect(read('pnpm-workspace.yaml')).toMatch(/^allowBuilds:\n {2}esbuild: true\n {2}workerd: true$/m);
    expect(read('pnpm-workspace.yaml')).not.toContain('minimumReleaseAgeExclude');
    for (const dir of ['frontend', 'backend', 'api']) expect(existsSync(join(repo, dir, 'pnpm-lock.yaml')), dir).toBe(true);
  });

  it('Dependabot updates go to develop, grouped, and leave the held-back majors alone', () => {
    const config = read('.github/dependabot.yml');
    expect(config.match(/^ {4}target-branch: develop$/gm)).toHaveLength(2);
    expect(config).toContain("directories: ['/', '/frontend', '/backend', '/api']");
    expect(config.match(/^ {4}groups:$/gm)).toHaveLength(2);
    // Subjects like "chore: bump the minor group across 4 directories with 12 updates" fit the 72-character rule.
    expect(config.match(/^ {6}prefix: (chore|ci)$/gm)).toHaveLength(2);
    for (const held of ['supabase', 'eslint']) expect(config).toContain(`dependency-name: ${held}`);
  });
});

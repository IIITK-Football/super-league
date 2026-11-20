// Group: api-services. The production Workers Builds deploy command deploys only the production Worker, only from main,
// only inside Workers Builds, and only bound to exactly the production media buckets.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { PRODUCTION_WORKER, productionProblems } from '../scripts/deploy-production.mjs';
// @ts-expect-error plain ESM script without types
import { readConfig } from '../scripts/deploy-staging.mjs';

const script = join(__dirname, '../scripts/deploy-production.mjs');
const ci = { WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main' };
const check = (env: Record<string, string>) =>
  spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } });

describe('production deploy command', () => {
  it('passes for main inside Workers Builds with the committed configuration', () => {
    const r = check(ci);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(PRODUCTION_WORKER);
  });

  it.each(['develop', 'feature/x', ''])('refuses branch "%s"', (branch) => {
    const r = check({ ...ci, WORKERS_CI_BRANCH: branch });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('production deploys only from main');
  });

  it('refuses outside Workers Builds', () => {
    expect(check({ WORKERS_CI_BRANCH: 'main' }).status).toBe(1);
  });

  it('refuses a staging bucket, a missing binding, a wrong name or a non-production environment', () => {
    const good = readConfig();
    expect(productionProblems(ci, good)).toEqual([]);
    const staging = structuredClone(good);
    staging.env.production.r2_buckets[0].bucket_name = 'sl-staging-news-images';
    expect(productionProblems(ci, staging).join()).toContain('must bind exactly');
    const missing = structuredClone(good);
    missing.env.production.r2_buckets.pop();
    expect(productionProblems(ci, missing).join()).toContain('must bind exactly');
    const renamed = structuredClone(good);
    renamed.env.production.name = 'super-league-api-staging';
    expect(productionProblems(ci, renamed).join()).toContain('env.production.name');
    const env = structuredClone(good);
    env.env.production.vars.SL_ENVIRONMENT = 'staging';
    expect(productionProblems(ci, env).join()).toContain('SL_ENVIRONMENT');
  });
});

// Group: api-services. The Workers Builds deploy command deploys only the staging Worker, only from develop, only
// inside Workers Builds, and only with the production marker the Worker needs to refuse a production database.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { readConfig, stagingProblems, STAGING_WORKER } from '../scripts/deploy-staging.mjs';

const script = join(__dirname, '../scripts/deploy-staging.mjs');
const ci = { WORKERS_CI: '1', WORKERS_CI_BRANCH: 'develop' };
const check = (env: Record<string, string>) =>
  spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } });

describe('staging deploy command', () => {
  it('passes for develop inside Workers Builds with the committed configuration', () => {
    const r = check(ci);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(STAGING_WORKER);
  });

  it.each(['main', 'feature/x', ''])('refuses branch "%s"', (branch) => {
    const r = check({ ...ci, WORKERS_CI_BRANCH: branch });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('staging deploys only from develop');
  });

  it('refuses outside Workers Builds', () => {
    const r = check({ WORKERS_CI_BRANCH: 'develop' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Only Cloudflare Workers Builds');
  });

  it('refuses a configuration that would not deploy the staging Worker safely', () => {
    const good = readConfig();
    expect(stagingProblems(ci, good)).toEqual([]);
    const renamed = structuredClone(good);
    renamed.env.staging.name = 'super-league-api';
    expect(stagingProblems(ci, renamed).join()).toContain('env.staging.name');
    const noMarker = structuredClone(good);
    delete noMarker.env.staging.vars.SL_PRODUCTION_SUPABASE_REF;
    expect(stagingProblems(ci, noMarker).join()).toContain('SL_PRODUCTION_SUPABASE_REF');
    const topLevel = structuredClone(good);
    topLevel.name = STAGING_WORKER;
    expect(stagingProblems(ci, topLevel).join()).toContain('top-level');
  });

  it('defines no environment other than staging', () => {
    expect(Object.keys(readConfig().env)).toEqual(['staging']);
  });
});

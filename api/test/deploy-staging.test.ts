// Group: api-services. The Workers Builds deploy command deploys only the staging Worker, only from develop, only
// inside Workers Builds, and only with the production marker the Worker needs to refuse a production database.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { mediaProblems, readConfig, stagingProblems, STAGING_WORKER } from '../scripts/deploy-staging.mjs';

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

  it('binds staging to exactly its three sl-staging-* buckets', () => {
    const staging = readConfig().env.staging;
    expect(Object.fromEntries(staging.r2_buckets.map((b: { binding: string; bucket_name: string }) => [b.binding, b.bucket_name]))).toEqual({
      R2_NEWS: 'sl-staging-news-images',
      R2_PLAYERS: 'sl-staging-player-images',
      R2_LOGOS: 'sl-staging-team-logos',
    });
    expect(mediaProblems(staging).filter((p: string) => !p.includes('MEDIA_BASE'))).toEqual([]);
  });

  it('refuses a production bucket, a missing binding or an extra binding for staging', () => {
    const base = structuredClone(readConfig().env.staging);
    Object.assign(base.vars, { MEDIA_BASE_NEWS: 'https://pub-a.r2.dev', MEDIA_BASE_PLAYERS: 'https://pub-b.r2.dev', MEDIA_BASE_LOGOS: 'https://pub-c.r2.dev' });
    expect(mediaProblems(base)).toEqual([]);
    const prod = structuredClone(base);
    prod.r2_buckets[0].bucket_name = 'news-images';
    expect(mediaProblems(prod).join()).toContain('only sl-staging-* buckets');
    const missing = structuredClone(base);
    missing.r2_buckets.pop();
    expect(mediaProblems(missing).join()).toContain('must bind exactly');
    const extra = structuredClone(base);
    extra.r2_buckets.push({ binding: 'R2_BACKUP', bucket_name: 'sl-staging-backup' });
    expect(mediaProblems(extra).join()).toContain('must bind exactly');
  });

  it('refuses missing, non-https or production public bases for staging media', () => {
    const base = structuredClone(readConfig().env.staging);
    Object.assign(base.vars, { MEDIA_BASE_NEWS: 'https://pub-a.r2.dev', MEDIA_BASE_PLAYERS: 'https://pub-b.r2.dev', MEDIA_BASE_LOGOS: 'https://pub-c.r2.dev' });
    const placeholder = structuredClone(base);
    placeholder.vars.MEDIA_BASE_NEWS = 'STAGING_NEWS_PUBLIC_URL';
    expect(mediaProblems(placeholder).join()).toContain('MEDIA_BASE_NEWS must be the public https URL');
    const http = structuredClone(base);
    http.vars.MEDIA_BASE_LOGOS = 'http://pub-c.r2.dev';
    expect(mediaProblems(http).join()).toContain('must use https');
    const prodHost = structuredClone(base);
    prodHost.vars.MEDIA_BASE_PLAYERS = 'https://pub-156b66d0ff7841bc9601620610a8ebd3.r2.dev';
    expect(mediaProblems(prodHost).join()).toContain('production media host');
  });

  it('defines no environment other than staging', () => {
    expect(Object.keys(readConfig().env)).toEqual(['staging']);
  });
});

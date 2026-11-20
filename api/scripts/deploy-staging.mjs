#!/usr/bin/env node
// The deploy command for Cloudflare Workers Builds, connected to the super-league-api-staging Worker and the
// develop branch (docs/worker-staging.md). It is the ONLY way the API Worker is deployed before the release, and it
// deploys only the staging environment. It refuses, before anything is uploaded:
// - outside Workers Builds (no deploys from a laptop or another CI);
// - any branch but develop;
// - a configuration whose staging environment is not the staging Worker, or lacks the production-project marker the
//   Worker uses to refuse a production database at runtime.
// `--check` runs the checks only (used by the tests); otherwise it type-checks and runs `wrangler deploy --env staging`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const STAGING_WORKER = 'super-league-api-staging';
export const STAGING_BRANCH = 'develop';

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');

// wrangler.jsonc allows whole-line // comments; that is the only JSONC feature this file uses.
export function readConfig(file = join(apiDir, 'wrangler.jsonc')) {
  const text = readFileSync(file, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  return JSON.parse(text.replace(/,(\s*[}\]])/g, '$1'));
}

export function stagingProblems(env, config) {
  const problems = [];
  if (env.WORKERS_CI !== '1') problems.push('Only Cloudflare Workers Builds deploys the staging Worker (WORKERS_CI is not 1).');
  if (env.WORKERS_CI_BRANCH !== STAGING_BRANCH) {
    problems.push(`Refusing to deploy from branch "${env.WORKERS_CI_BRANCH ?? '(unknown)'}": staging deploys only from ${STAGING_BRANCH}.`);
  }
  const staging = config?.env?.staging;
  if (staging?.name !== STAGING_WORKER) problems.push(`wrangler.jsonc env.staging.name must be ${STAGING_WORKER}.`);
  if (staging?.vars?.SL_ENVIRONMENT !== 'staging') problems.push('wrangler.jsonc env.staging.vars.SL_ENVIRONMENT must be "staging".');
  if (!/^[a-z]{20}$/.test(staging?.vars?.SL_PRODUCTION_SUPABASE_REF ?? '')) {
    problems.push('wrangler.jsonc env.staging.vars.SL_PRODUCTION_SUPABASE_REF must name the production project, so the Worker can refuse it.');
  }
  if (config?.name === STAGING_WORKER) problems.push('The top-level Worker name must not be the staging Worker (only --env staging deploys it).');
  problems.push(...mediaProblems(staging));
  return problems;
}

// Staging media: exactly the three bindings, each to an sl-staging-* bucket, and a public https base for each that
// is not a production media host. The Worker has no R2 credentials, so these bindings are its only R2 access.
export const STAGING_BUCKETS = { R2_NEWS: 'news-images', R2_PLAYERS: 'player-images', R2_LOGOS: 'team-logos' };
// The read-only home video (MEDIA_BASE_VIDEO) may use the production intro host; write targets may not.
const PRODUCTION_HOST = /^pub-(faaac762b0254fb88c3967f021ced499|156b66d0ff7841bc9601620610a8ebd3|b7d837d92cb644838cb24feef9b3329e|44b1a3890e2b40c4836f3a3c8e18f090|5fcbf3326b604a8284068a24252f1585)\.r2\.dev$/;

export function mediaProblems(staging) {
  const problems = [];
  const buckets = staging?.r2_buckets ?? [];
  const bindings = buckets.map((b) => b.binding).sort();
  if (JSON.stringify(bindings) !== JSON.stringify(Object.keys(STAGING_BUCKETS).sort())) {
    problems.push(`env.staging.r2_buckets must bind exactly ${Object.keys(STAGING_BUCKETS).join(', ')}.`);
  }
  for (const b of buckets) {
    if (!/^sl-staging-[a-z0-9-]+$/.test(b.bucket_name ?? '')) problems.push(`Refusing ${b.binding} -> "${b.bucket_name}": staging may bind only sl-staging-* buckets.`);
    if (b.preview_bucket_name || b.jurisdiction) problems.push(`${b.binding} must not set preview_bucket_name or jurisdiction.`);
  }
  for (const name of ['MEDIA_BASE_NEWS', 'MEDIA_BASE_PLAYERS', 'MEDIA_BASE_LOGOS', 'MEDIA_BASE_VIDEO']) {
    let url = null;
    try {
      url = new URL(staging?.vars?.[name] ?? '');
    } catch {
      problems.push(`env.staging.vars.${name} must be the public https URL of its bucket.`);
      continue;
    }
    if (url.protocol !== 'https:') problems.push(`env.staging.vars.${name} must use https.`);
    if (name !== 'MEDIA_BASE_VIDEO' && PRODUCTION_HOST.test(url.host)) problems.push(`env.staging.vars.${name} points at a production media host.`);
  }
  return problems;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: apiDir, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = stagingProblems(process.env, readConfig());
  if (problems.length) {
    console.error(['Staging deploy refused:', ...problems.map((p) => `- ${p}`)].join('\n'));
    process.exit(1);
  }
  if (process.argv.includes('--check')) {
    console.log(`Staging deploy checks passed: ${STAGING_WORKER} from ${STAGING_BRANCH}.`);
    process.exit(0);
  }
  run('pnpm', ['exec', 'tsc', '--noEmit']);
  run('pnpm', ['exec', 'wrangler', 'deploy', '--env', 'staging']);
}

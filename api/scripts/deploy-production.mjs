#!/usr/bin/env node
// The deploy command for Cloudflare Workers Builds, connected to the super-league-api (production) Worker and the
// main branch. It deploys only the production environment and refuses, before anything is uploaded:
// - outside Workers Builds (no production deploys from a laptop or another CI);
// - any branch but main;
// - a configuration whose production environment is not the production Worker bound to exactly the production media
//   buckets with SL_ENVIRONMENT=production, or that binds any staging or local bucket.
// `--check` runs the checks only (used by the tests); otherwise it type-checks and runs `wrangler deploy --env production`.
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readConfig } from './deploy-staging.mjs';

export const PRODUCTION_WORKER = 'super-league-api';
export const PRODUCTION_BRANCH = 'main';
export const PRODUCTION_BUCKETS = { R2_NEWS: 'news-images', R2_PLAYERS: 'player-images', R2_LOGOS: 'team-logos' };

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');

export function productionProblems(env, config) {
  const problems = [];
  if (env.WORKERS_CI !== '1') problems.push('Only Cloudflare Workers Builds deploys the production Worker (WORKERS_CI is not 1).');
  if (env.WORKERS_CI_BRANCH !== PRODUCTION_BRANCH) {
    problems.push(`Refusing to deploy from branch "${env.WORKERS_CI_BRANCH ?? '(unknown)'}": production deploys only from ${PRODUCTION_BRANCH}.`);
  }
  const prod = config?.env?.production;
  if (prod?.name !== PRODUCTION_WORKER) problems.push(`wrangler.jsonc env.production.name must be ${PRODUCTION_WORKER}.`);
  if (prod?.vars?.SL_ENVIRONMENT !== 'production') problems.push('wrangler.jsonc env.production.vars.SL_ENVIRONMENT must be "production".');
  const bound = Object.fromEntries((prod?.r2_buckets ?? []).map((b) => [b.binding, b.bucket_name]));
  if (JSON.stringify(bound, Object.keys(bound).sort()) !== JSON.stringify(PRODUCTION_BUCKETS, Object.keys(PRODUCTION_BUCKETS).sort())) {
    problems.push(`env.production.r2_buckets must bind exactly ${Object.entries(PRODUCTION_BUCKETS).map(([k, v]) => `${k} -> ${v}`).join(', ')}.`);
  }
  for (const name of ['MEDIA_BASE_NEWS', 'MEDIA_BASE_PLAYERS', 'MEDIA_BASE_LOGOS', 'MEDIA_BASE_VIDEO']) {
    let url = null;
    try {
      url = new URL(prod?.vars?.[name] ?? '');
    } catch {
      problems.push(`env.production.vars.${name} must be the public https URL of its bucket.`);
      continue;
    }
    if (url.protocol !== 'https:') problems.push(`env.production.vars.${name} must use https.`);
  }
  return problems;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: apiDir, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = productionProblems(process.env, readConfig());
  if (problems.length) {
    console.error(['Production deploy refused:', ...problems.map((p) => `- ${p}`)].join('\n'));
    process.exit(1);
  }
  if (process.argv.includes('--check')) {
    console.log(`Production deploy checks passed: ${PRODUCTION_WORKER} from ${PRODUCTION_BRANCH}.`);
    process.exit(0);
  }
  run('pnpm', ['exec', 'tsc', '--noEmit']);
  run('pnpm', ['exec', 'wrangler', 'deploy', '--env', 'production']);
}

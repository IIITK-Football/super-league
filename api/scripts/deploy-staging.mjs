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

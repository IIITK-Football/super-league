#!/usr/bin/env node
// Read-only staging evidence for the API Worker, through the staging Pages origin (the browser path: Pages → service
// binding → Worker → staging Data API). GET requests only; nothing is written anywhere.
// - the release: /api/health (environment, commit, Worker version);
// - a scoped public read: /api/standings?division=super-league (status, rows, Server-Timing);
// - timing: N samples each of the standings read and the home dashboard, with median and p95 of the wall time seen
//   here and of the Worker's own Server-Timing total, and the dashboard's Data API rounds.
// Used before and after a Smart Placement change with the same sample count, labelled with --label.
//
// Site: STAGING_SITE_URL, default https://develop.super-league.pages.dev; only *.super-league.pages.dev preview hosts,
// never the production site. Access: the Cloudflare Access service token from the Keychain (docs/worker-staging.md).
// Usage: node scripts/staging-worker-probe.mjs [--samples 30] [--label placement-off]
import { accessHeaders, verifySite } from './staging-media-check.mjs';

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[index] * 10) / 10;
}

export function parseServerTiming(header) {
  const total = /total;dur=([\d.]+)/.exec(header ?? '')?.[1];
  const db = /db;dur=([\d.]+)/.exec(header ?? '')?.[1];
  const rounds = /rounds=(\d+)/.exec(header ?? '')?.[1];
  return { total: total ? Number(total) : null, db: db ? Number(db) : null, rounds: rounds ? Number(rounds) : null };
}

export function summarize(samples) {
  const pick = (key) => samples.map((s) => s[key]).filter((v) => typeof v === 'number');
  return {
    samples: samples.length,
    ok: samples.filter((s) => s.status === 200).length,
    wallMs: { median: percentile(pick('wall'), 50), p95: percentile(pick('wall'), 95) },
    workerTotalMs: { median: percentile(pick('total'), 50), p95: percentile(pick('total'), 95) },
    dbMs: { median: percentile(pick('db'), 50), p95: percentile(pick('db'), 95) },
    maxRounds: pick('rounds').length ? Math.max(...pick('rounds')) : null,
  };
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const site = (process.env.STAGING_SITE_URL || 'https://develop.super-league.pages.dev').replace(/\/+$/, '');
  const problems = verifySite(site);
  if (problems.length) throw new Error(problems.join('; '));
  const headers = accessHeaders();
  const samples = Math.min(100, Math.max(1, Number(arg('--samples', '30'))));
  const get = async (path) => {
    const started = performance.now();
    const res = await fetch(`${site}/api${path}`, { headers, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    const wall = performance.now() - started;
    const body = await res.text();
    return { status: res.status, wall, timing: res.headers.get('Server-Timing'), cache: res.headers.get('Cache-Control'), body };
  };

  const health = await get('/health');
  let release = null;
  try { release = JSON.parse(health.body); } catch { /* not JSON: reported by status */ }
  if (health.status !== 200 || release?.environment !== 'staging') {
    throw new Error(`staging health answered ${health.status}${release ? ` (environment ${release.environment})` : ''}; is the Access token valid and the Worker bound?`);
  }

  const scoped = await get('/standings?division=super-league');
  let scopedBody = null;
  try { scopedBody = JSON.parse(scoped.body); } catch { /* reported by status */ }

  const run = async (path) => {
    const out = [];
    for (let i = 0; i < samples; i += 1) {
      const r = await get(path);
      out.push({ status: r.status, wall: r.wall, ...parseServerTiming(r.timing) });
    }
    return summarize(out);
  };
  const standings = await run('/standings?division=super-league');
  const dashboard = await run('/home/dashboard?division=super-league');

  const evidence = {
    item: 'SL-030',
    label: arg('--label', 'staging'),
    site,
    recordedAt: new Date().toISOString(),
    release: { environment: release.environment, commit: release.commit ?? null, version: release.version ?? null },
    scopedRead: {
      path: '/api/standings?division=super-league',
      status: scoped.status,
      success: scopedBody?.success ?? null,
      rows: Array.isArray(scopedBody?.data) ? scopedBody.data.length : null,
      serverTiming: scoped.timing,
      cacheControl: scoped.cache,
    },
    timing: { standings, dashboard },
  };
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`staging-worker-probe: ${error.message}\n`);
    process.exit(1);
  });
}

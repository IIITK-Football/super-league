#!/usr/bin/env node
// SL-031 staging evidence: the browser's same-origin /api path on the staging site (Pages → its API service binding →
// the staging Worker → the staging Data API), behind Cloudflare Access.
// - the release pair: the site's /version.json and the Worker's /api/health (commit and version);
// - a public read, and every answer's Cache-Control: no-store;
// - the bearer token forwarded: a temporary signed-in account reads its own history (200) and is refused a dictator
//   write by the database (403, nothing stored); without a session the read is 401 and the write is refused by the
//   Worker (401);
// - stable JSON errors: unknown route 404, invalid input 400, unknown division 404.
// The temporary account is created on STAGING with the staging server key and deleted at the end. Nothing else is
// written. Prints one JSON evidence document to standard output.
//
// Site: STAGING_SITE_URL, default https://develop.super-league.pages.dev; preview hosts only, never production. A
// rolled-back pair is checked at the older preview deployment's own URL (<hash>.super-league.pages.dev), since Pages
// previews keep their URL but cannot be rolled back.
// --previous: the restored pair predates SL-031, so its site has no /version.json and its answers no default
// Cache-Control; those two rules are skipped and every other rule applies (docs/rollback/pages-worker-pair.md).
// Usage: node scripts/staging-routing-check.mjs [--previous]
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvText, STAGING_REF, verifyTarget } from './staging-checks.mjs';
import { accessHeaders, verifySite } from './staging-media-check.mjs';

// The same-origin answers that make up the routing contract, judged from what the site returned.
export function judge(answers, { previous = false } = {}) {
  const { version, health, standings, history, historyAnon, write, writeAnon, errors } = answers;
  const all = [health, standings, history, historyAnon, write, writeAnon, ...errors];
  const sha = (v) => /^[0-9a-f]{7,40}$/.test(v ?? '');
  const checks = [
    previous
      ? ['the restored Worker answers from the same origin and names its release', health.status === 200 && health.body?.environment === 'staging' && sha(health.body?.commit)]
      : ['the site and the Worker name their release from the same origin',
        version.status === 200 && sha(version.body?.commit) && health.status === 200 && health.body?.environment === 'staging' && sha(health.body?.commit)],
    ['a public read reaches the staging Worker', standings.status === 200 && standings.body?.success === true],
    ["the caller's bearer token is forwarded on a read (signed-in 200, signed-out 401)", history.status === 200 && historyAnon.status === 401],
    ['a protected write: signed-in non-dictator refused by the database (403), missing session by the Worker (401)', write.status === 403 && writeAnon.status === 401],
    ['errors are stable JSON (404 unknown route, 400 invalid input, 404 unknown division)',
      errors.map((e) => e.status).join() === '404,400,404' && errors.every((e) => /application\/json/.test(e.type ?? '') && e.body?.success === false)],
  ];
  if (!previous) checks.push(['every /api answer carries Cache-Control: no-store', all.every((a) => a.cache === 'no-store')]);
  return checks.map(([name, pass]) => ({ name, pass: Boolean(pass) }));
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const envFile = join(root, 'backend/.env.staging.local');
  if (!existsSync(envFile)) throw new Error('backend/.env.staging.local is missing');
  const env = loadEnvText(readFileSync(envFile, 'utf8'));
  const site = (process.env.STAGING_SITE_URL || 'https://develop.super-league.pages.dev').replace(/\/+$/, '');
  const problems = [...verifyTarget(env), ...verifySite(site)];
  if (problems.length) throw new Error(`refusing to run: ${problems.join('; ')}`);
  const access = accessHeaders();

  const base = `https://${STAGING_REF}.supabase.co`;
  const admin = { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' };
  const authCall = async (path, init = {}) => {
    const r = await fetch(`${base}/auth/v1${path}`, { ...init, headers: { ...admin, ...(init.headers || {}) } });
    const text = await r.text();
    return { ok: r.ok, status: r.status, data: text ? JSON.parse(text) : null };
  };
  const get = async (path, init = {}) => {
    const res = await fetch(`${site}${path}`, { redirect: 'manual', ...init, headers: { ...access, ...(init.headers || {}) } });
    if (res.status >= 300 && res.status < 400) throw new Error('Cloudflare Access refused the service token (redirected to sign-in)');
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body, type: res.headers.get('Content-Type'), cache: res.headers.get('Cache-Control') };
  };

  const email = `sl-check-routing-${randomBytes(4).toString('hex')}@iiitkottayam.ac.in`;
  const created = await authCall('/admin/users', { method: 'POST', body: JSON.stringify({ email, password: randomBytes(16).toString('hex'), email_confirm: true }) });
  if (!created.ok) throw new Error(`could not create the temporary staging account (${created.status})`);
  try {
    const link = await authCall('/admin/generate_link', { method: 'POST', body: JSON.stringify({ type: 'magiclink', email }) });
    const v = await fetch(`${base}/auth/v1/verify`, { method: 'POST', headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: link.data?.hashed_token }) });
    const session = await v.json();
    if (!session.access_token) throw new Error('could not sign in the temporary staging account');
    const bearer = { Authorization: `Bearer ${session.access_token}` };
    const json = { 'Content-Type': 'application/json' };

    const answers = {
      version: await get('/version.json'),
      health: await get('/api/health'),
      standings: await get('/api/standings?division=super-league'),
      history: await get('/api/predictions/history?division=super-league', { headers: bearer }),
      historyAnon: await get('/api/predictions/history?division=super-league'),
      write: await get('/api/admin/matches', { method: 'POST', headers: { ...bearer, ...json }, body: JSON.stringify({ division: 'super-league' }) }),
      writeAnon: await get('/api/admin/matches', { method: 'POST', headers: json, body: '{}' }),
      errors: [
        await get('/api/no-such-route'),
        await get('/api/standings?division=Bad%20Slug'),
        await get('/api/standings?division=no-such-division'),
      ],
    };
    const previous = process.argv.includes('--previous');
    const checks = judge(answers, { previous });
    for (const c of checks) process.stderr.write(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}\n`);
    const evidence = {
      item: 'SL-031',
      mode: process.argv.includes('--previous') ? 'restored previous pair' : 'current pair',
      site,
      recordedAt: new Date().toISOString(),
      release: { site: answers.version.body, worker: answers.health.body },
      observed: {
        standings: answers.standings.status,
        history: { signedIn: answers.history.status, signedOut: answers.historyAnon.status },
        write: { signedIn: answers.write.status, signedOut: answers.writeAnon.status },
        errors: answers.errors.map((e) => ({ status: e.status, message: e.body?.message })),
        cacheControl: [...new Set([answers.health, answers.standings, answers.history, answers.historyAnon, answers.write, answers.writeAnon, ...answers.errors].map((a) => a.cache))],
      },
      passed: checks.every((c) => c.pass),
      checks,
    };
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    process.exitCode = evidence.passed ? 0 : 1;
  } finally {
    await authCall(`/admin/users/${created.data.id}`, { method: 'DELETE' });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`staging-routing-check: ${error.message}\n`);
    process.exit(1);
  });
}

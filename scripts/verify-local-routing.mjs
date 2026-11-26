#!/usr/bin/env node
// SL-031 local evidence: the browser's same-origin /api path through the REAL Pages function and the REAL Worker
// runtime, against THIS repository's local Supabase stack.
//   1. Builds the frontend (dist/, with version.json) and starts the API Worker (`wrangler dev`, :8787).
//   2. Serves dist/ with `wrangler pages dev` and the Pages functions, binding API to the local Worker (:8790), and
//      checks: the site's version.json and the Worker's health from the same origin; a public read; the caller's
//      bearer token forwarded (a signed-in read succeeds and a protected write is refused by the database, not by a
//      missing session); missing-session, unknown-route and invalid-input errors as JSON; Cache-Control: no-store.
//   3. Checks the same signed-in read through the Vite dev proxy (:5173), the local development path.
//   4. Serves the site WITHOUT the binding (:8791) and checks /api fails closed with 503.
// Prints one JSON evidence document to standard output; progress goes to standard error.
// Usage: node scripts/verify-local-routing.mjs
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = join(REPO, 'api');
const FRONTEND = join(REPO, 'frontend');
const WRANGLER = join(API_DIR, 'node_modules/.bin/wrangler');
const VITE = join(FRONTEND, 'node_modules/.bin/vite');
const PORTS = { worker: 8787, pages: 8790, unbound: 8791, vite: 5173 };

const log = (line) => process.stderr.write(`${line}\n`);
const fail = (message) => {
  log(`verify-local-routing: ${message}`);
  process.exit(1);
};

// Only this repository's local stack: the status call and the Worker's own settings must both name it.
export function localProblems(status, devVars) {
  const problems = [];
  if (status?.API_URL !== 'http://127.0.0.1:54321') problems.push('the Supabase API is not the local stack on 127.0.0.1:54321');
  if (!String(status?.DB_URL ?? '').includes('127.0.0.1:54322')) problems.push('the database is not the local stack on 54322');
  const workerUrl = /^SUPABASE_URL=(.*)$/m.exec(devVars ?? '')?.[1]?.trim();
  if (workerUrl !== 'http://127.0.0.1:54321') problems.push('api/.dev.vars does not point the Worker at the local stack');
  return problems;
}

function start(name, cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' }, detached: true });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  return { name, child, output: () => output };
}

function stop(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.child.exitCode !== null) return resolve();
    const group = (signal) => { try { process.kill(-proc.child.pid, signal); } catch { /* gone */ } };
    proc.child.once('exit', () => resolve());
    group('SIGTERM');
    setTimeout(() => { group('SIGKILL'); resolve(); }, 5000);
  });
}

async function waitFor(url, proc, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(3000) });
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  log(proc.output().slice(-2000));
  fail(`${proc.name} did not start at ${url}`);
}

async function main() {
  const r = spawnSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], { encoding: 'utf8', cwd: join(REPO, 'backend') });
  if (r.status !== 0) fail('local Supabase is not running (pnpm db:start).');
  const status = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  const problems = localProblems(status, readFileSync(join(API_DIR, '.dev.vars'), 'utf8'));
  if (problems.length) fail(problems.join('; '));
  for (const port of Object.values(PORTS)) {
    const taken = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
    if (taken) fail(`port ${port} is already serving; stop that server first so the evidence comes from this run.`);
  }

  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: REPO }).stdout.trim();
  const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8', cwd: REPO }).stdout.trim() !== '';
  log('building the frontend');
  const build = spawnSync(VITE, ['build'], { cwd: FRONTEND, encoding: 'utf8' });
  if (build.status !== 0) fail(`frontend build failed:\n${build.stderr.slice(-2000)}`);

  // A temporary local account, created and signed in through the local Auth admin API (removed at the end).
  const auth = async (path, body, key = status.SECRET_KEY) => {
    const res = await fetch(`${status.API_URL}/auth/v1${path}`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return res.json();
  };
  const email = `authtest.routing.${Date.now().toString(36)}@iiitkottayam.ac.in`;
  const created = await auth('/admin/users', { email, email_confirm: true });
  if (!created?.id) fail('could not create the local test account');
  const link = await auth('/admin/generate_link', { type: 'magiclink', email });
  const session = await auth('/verify', { type: 'magiclink', token_hash: link?.hashed_token ?? link?.properties?.hashed_token }, status.PUBLISHABLE_KEY);
  if (!session?.access_token) fail('could not sign in the local test account');
  const token = session.access_token;
  const removeAccount = () => fetch(`${status.API_URL}/auth/v1/admin/users/${created.id}`, {
    method: 'DELETE', headers: { apikey: status.SECRET_KEY, Authorization: `Bearer ${status.SECRET_KEY}` },
  });

  const checks = [];
  const check = (name, pass, observed) => {
    checks.push({ name, pass: Boolean(pass), observed });
    log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
  };
  const get = async (base, path, init = {}) => {
    const res = await fetch(`${base}${path}`, { redirect: 'manual', ...init });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body, type: res.headers.get('Content-Type'), cache: res.headers.get('Cache-Control'), timing: res.headers.get('Server-Timing') };
  };
  const bearer = { Authorization: `Bearer ${token}` };

  let worker; let pages; let vite; let unbound;
  try {
    worker = start('the API Worker', WRANGLER, ['dev', '--port', String(PORTS.worker), '--ip', '127.0.0.1', '--show-interactive-dev-session=false'], API_DIR);
    await waitFor(`http://127.0.0.1:${PORTS.worker}/api/health`, worker);
    pages = start('the Pages site', WRANGLER, ['pages', 'dev', 'dist', '--port', String(PORTS.pages), '--ip', '127.0.0.1', '--service', 'API=super-league-api', '--show-interactive-dev-session=false'], FRONTEND);
    const site = `http://127.0.0.1:${PORTS.pages}`;
    await waitFor(`${site}/version.json`, pages);

    const version = await get(site, '/version.json');
    const health = await get(site, '/api/health');
    check('the site and the Worker name their release from the same origin', version.status === 200 && version.body?.commit === commit && health.status === 200 && health.body?.environment === 'local', {
      site: version.body, worker: health.body,
    });

    const standings = await get(site, '/api/standings?division=super-league');
    check('a public read reaches the Worker through the Pages function', standings.status === 200 && standings.body?.success === true && /^total;dur=/.test(standings.timing ?? ''), {
      status: standings.status, serverTiming: standings.timing, cacheControl: standings.cache,
    });

    const history = await get(site, '/api/predictions/history?division=super-league', { headers: bearer });
    const historyAnon = await get(site, '/api/predictions/history?division=super-league');
    check("the caller's bearer token is forwarded on a read (signed-in 200, signed-out 401)", history.status === 200 && historyAnon.status === 401, {
      signedIn: history.status, signedOut: historyAnon.status,
    });

    const write = await get(site, '/api/admin/matches', { method: 'POST', headers: { ...bearer, 'Content-Type': 'application/json' }, body: JSON.stringify({ division: 'super-league' }) });
    const writeAnon = await get(site, '/api/admin/matches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    check('a protected write: a signed-in non-dictator is refused by the database (403), a missing session by the Worker (401)', write.status === 403 && writeAnon.status === 401, {
      signedIn: { status: write.status, message: write.body?.message }, signedOut: { status: writeAnon.status, message: writeAnon.body?.message },
    });

    const errors = await Promise.all([
      get(site, '/api/no-such-route'),
      get(site, '/api/standings?division=Bad%20Slug'),
      get(site, '/api/standings?division=no-such-division'),
    ]);
    check('errors are stable JSON (404 unknown route, 400 invalid input, 404 unknown division)', errors.map((e) => e.status).join() === '404,400,404' && errors.every((e) => /application\/json/.test(e.type ?? '') && e.body?.success === false), {
      answers: errors.map((e) => ({ status: e.status, message: e.body?.message })),
    });

    const all = [health, standings, history, historyAnon, write, writeAnon, ...errors];
    check('every /api answer carries Cache-Control: no-store', all.every((a) => a.cache === 'no-store'), { values: [...new Set(all.map((a) => a.cache))] });

    vite = start('the Vite dev server', VITE, ['--port', String(PORTS.vite), '--strictPort', '--host', '127.0.0.1'], FRONTEND);
    await waitFor(`http://127.0.0.1:${PORTS.vite}/`, vite);
    const viaVite = await get(`http://127.0.0.1:${PORTS.vite}`, '/api/predictions/history?division=super-league', { headers: bearer });
    check('the Vite dev proxy forwards the same signed-in read to the Worker', viaVite.status === 200 && viaVite.cache === 'no-store', { status: viaVite.status });
  } finally {
    await stop(vite);
    await stop(pages);
    await stop(worker);
  }

  try {
    unbound = start('the unbound Pages site', WRANGLER, ['pages', 'dev', 'dist', '--port', String(PORTS.unbound), '--ip', '127.0.0.1', '--show-interactive-dev-session=false'], FRONTEND);
    await waitFor(`http://127.0.0.1:${PORTS.unbound}/version.json`, unbound);
    const missing = await get(`http://127.0.0.1:${PORTS.unbound}`, '/api/health');
    check('without the API binding, /api fails closed with 503 and no-store', missing.status === 503 && missing.body?.success === false && missing.cache === 'no-store', {
      status: missing.status, message: missing.body?.message,
    });
  } finally {
    await stop(unbound);
    await removeAccount();
  }

  const evidence = {
    item: 'SL-031',
    runtime: 'wrangler pages dev (Pages functions) + wrangler dev (Worker) + vite dev proxy, local',
    commit,
    dirtyTrackedFiles: dirty,
    recordedAt: new Date().toISOString(),
    passed: checks.every((c) => c.pass),
    checks,
  };
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  process.exit(evidence.passed ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => fail(error?.stack ?? String(error)));

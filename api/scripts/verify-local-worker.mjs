#!/usr/bin/env node
// SL-030 local evidence through the REAL Worker runtime: starts `wrangler dev` (workerd) against THIS repository's local
// Supabase stack and checks, over HTTP:
// - health, a scoped public read, Server-Timing and the dashboard's rounds;
// - missing, malformed, expired and tampered tokens refused with 401, a caller without the grant refused, and nothing
//   stored by any refused write;
// - a dictator's write recorded with the dictator as actor;
// - a multi-write that fails part-way leaving nothing behind;
// - a second Worker configured as staging with the production database URL refusing every request (503) before any
//   outbound call (only /health is requested from it).
// Prints one JSON evidence document to standard output. Local only: it refuses any non-local Supabase target.
//
// Usage: pnpm --dir api verify:local
import { spawn, spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(API_DIR, '..');
const PORT = 8787;
const GUARD_PORT = 8788;
const PRODUCTION_REF = 'obkxfepdpdufxawhzaen';

const log = (...args) => process.stderr.write(`${args.join(' ')}\n`);
const fail = (message) => {
  log(`verify-local-worker: ${message}`);
  process.exit(1);
};

// 1. The target must be this repository's local stack, in both the status call and the Worker's own settings.
function localTarget() {
  const r = spawnSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], { encoding: 'utf8', cwd: join(REPO, 'backend') });
  if (r.status !== 0) fail('local Supabase is not running (pnpm db:start).');
  const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  if (out.API_URL !== 'http://127.0.0.1:54321' || !out.DB_URL?.includes('127.0.0.1:54322')) fail('the Supabase target is not the local stack on 54321/54322.');
  const devVars = readFileSync(join(API_DIR, '.dev.vars'), 'utf8');
  const workerUrl = /^SUPABASE_URL=(.*)$/m.exec(devVars)?.[1]?.trim();
  if (workerUrl !== 'http://127.0.0.1:54321') fail('api/.dev.vars does not point the Worker at the local stack.');
  return { url: out.API_URL, secret: out.SECRET_KEY, publishable: out.PUBLISHABLE_KEY, jwtSecret: out.JWT_SECRET };
}

function startWorker(port, extraArgs = []) {
  const child = spawn('pnpm', ['exec', 'wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--show-interactive-dev-session=false', ...extraArgs], {
    cwd: API_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1' },
    // Its own process group, so stopping it also stops the workerd process pnpm and wrangler start.
    detached: true,
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  return { child, output: () => output };
}

function stop(worker) {
  return new Promise((resolve) => {
    if (worker.child.exitCode !== null) return resolve();
    const group = (signal) => { try { process.kill(-worker.child.pid, signal); } catch { /* already gone */ } };
    worker.child.once('exit', () => resolve());
    group('SIGTERM');
    setTimeout(() => { group('SIGKILL'); resolve(); }, 5000);
  });
}

async function waitFor(url, worker, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      return res;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  log(worker.output().slice(-2000));
  fail(`the Worker did not start at ${url}`);
}

const b64url = (v) => Buffer.from(v).toString('base64url');

async function main() {
  const keys = localTarget();
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: REPO }).stdout.trim();
  const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8', cwd: REPO }).stdout.trim() !== '';
  const admin = createClient(keys.url, keys.secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = () => createClient(keys.url, keys.publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const sign = (payload) => {
    const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = b64url(JSON.stringify(payload));
    return `${head}.${body}.${createHmac('sha256', keys.jwtSecret).update(`${head}.${body}`).digest('base64url')}`;
  };

  const users = [];
  async function account(label, roles = []) {
    const email = `authtest.worker-${label}.${Date.now().toString(36)}@iiitkottayam.ac.in`;
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    users.push(data.user.id);
    for (const role of roles) {
      const r = await admin.from('user_roles').insert({ user_id: data.user.id, role });
      if (r.error) throw r.error;
    }
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    const v = await anon().auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' });
    if (v.error) throw v.error;
    return { id: data.user.id, token: v.data.session.access_token };
  }

  for (const port of [PORT, GUARD_PORT]) {
    const taken = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
    if (taken) fail(`port ${port} is already serving; stop that server first so the evidence comes from this run.`);
  }
  const worker = startWorker(PORT);
  const base = `http://127.0.0.1:${PORT}/api`;
  const checks = [];
  const check = (name, pass, observed) => {
    checks.push({ name, pass: Boolean(pass), observed });
    log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
  };
  const created = [];

  try {
    const health = await waitFor(`${base}/health`, worker);
    const healthBody = await health.json();
    check('health answers from the local Worker', health.status === 200 && healthBody.environment === 'local', { status: health.status, body: healthBody });

    const standings = await fetch(`${base}/standings?division=super-league`);
    const standingsBody = await standings.json();
    check('a scoped public read succeeds', standings.status === 200 && standingsBody.success === true, {
      status: standings.status, rows: Array.isArray(standingsBody.data) ? standingsBody.data.length : null, serverTiming: standings.headers.get('Server-Timing'),
    });

    const dashboard = await fetch(`${base}/home/dashboard?division=super-league`);
    const rounds = Number(/rounds=(\d+)/.exec(dashboard.headers.get('Server-Timing') ?? '')?.[1]);
    check('the dashboard takes at most 3 sequential Data API rounds', dashboard.status === 200 && rounds <= 3, {
      status: dashboard.status, serverTiming: dashboard.headers.get('Server-Timing'),
    });

    const plain = await account('plain');
    const dictator = await account('dictator', ['dictator']);
    const { data: season } = await admin.from('seasons').select('id, division:divisions!inner(slug)').eq('division.slug', 'super-league').eq('is_current', true).single();
    const teams = ((await admin.from('team_entries').select('team_id').eq('season_id', season.id).limit(2)).data ?? []).map((e) => e.team_id);
    const count = async () => (await admin.from('matches').select('id', { count: 'exact', head: true }).eq('season_id', season.id)).count;
    const createMatch = (authorization, extra = {}) => fetch(`${base}/admin/matches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
      body: JSON.stringify({ division: 'super-league', home_team_id: teams[0], away_team_id: teams[1], date: '2030-01-01T10:00:00Z', ...extra }),
    });

    const claims = JSON.parse(Buffer.from(plain.token.split('.')[1], 'base64url').toString());
    const [head, , sig] = plain.token.split('.');
    const tokens = {
      missing: null,
      malformed: 'Bearer not-a-token',
      expired: `Bearer ${sign({ ...claims, iat: 1_600_000_000, exp: 1_600_003_600 })}`,
      tampered: `Bearer ${head}.${b64url(JSON.stringify({ ...claims, role: 'service_role' }))}.${sig}`,
    };
    for (const [name, authorization] of Object.entries(tokens)) {
      const before = await count();
      const res = await createMatch(authorization);
      const after = await count();
      check(`a ${name} token is refused with 401 and stores nothing`, res.status === 401 && before === after, { status: res.status, matchesBefore: before, matchesAfter: after });
    }

    {
      const before = await count();
      const res = await createMatch(`Bearer ${plain.token}`);
      const after = await count();
      check('a valid caller without the dictator grant is refused (403) and stores nothing', res.status === 403 && before === after, { status: res.status, matchesBefore: before, matchesAfter: after });
    }

    {
      const res = await createMatch(`Bearer ${dictator.token}`);
      const body = await res.json();
      if (body?.data?.id) created.push(body.data.id);
      const { data: audit } = await admin.from('audit_log').select('actor_id, action').eq('table_name', 'matches').eq('record_id', body?.data?.id ?? '');
      check("a dictator's write records the dictator as actor", res.status === 200 && audit?.length === 1 && audit[0].actor_id === dictator.id && audit[0].action === 'insert', {
        status: res.status, audit: audit?.map((a) => ({ actorIsDictator: a.actor_id === dictator.id, action: a.action })),
      });
    }

    {
      const before = await count();
      const res = await createMatch(`Bearer ${dictator.token}`, { is_walkover: true, walkover_winner: 'home', walkover_reason: 'evidence', awarded_home: -1, awarded_away: 0 });
      const after = await count();
      check('a multi-write that fails part-way leaves nothing behind', res.status === 400 && before === after, { status: res.status, matchesBefore: before, matchesAfter: after });
    }

  } finally {
    if (created.length) await admin.from('matches').delete().in('id', created);
    for (const id of users) await admin.auth.admin.deleteUser(id);
    await stop(worker);
  }

  // Wrangler instances share local state, so the guard Worker starts only after the first one stopped.
  // Its own name, so it can never stand in for super-league-api in the local dev registry (a Pages binding).
  const guard = startWorker(GUARD_PORT, [
    '--name', 'super-league-api-guard',
    '--var', 'SL_ENVIRONMENT:staging',
    '--var', `SL_PRODUCTION_SUPABASE_REF:${PRODUCTION_REF}`,
    '--var', `SUPABASE_URL:https://${PRODUCTION_REF}.supabase.co`,
  ]);
  try {
    const guardHealth = await waitFor(`http://127.0.0.1:${GUARD_PORT}/api/health`, guard);
    check('a non-production Worker configured with the production database refuses every request', guardHealth.status === 503, { status: guardHealth.status });
  } finally {
    await stop(guard);
  }

  const evidence = {
    item: 'SL-030',
    runtime: 'wrangler dev (workerd), local',
    commit,
    dirtyTrackedFiles: dirty,
    recordedAt: new Date().toISOString(),
    supabase: 'local 127.0.0.1:54321 / 54322',
    passed: checks.every((c) => c.pass),
    checks,
  };
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  process.exit(evidence.passed ? 0 : 1);
}

main().catch((error) => fail(error?.stack ?? String(error)));

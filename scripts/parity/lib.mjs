// Shared parts of the SL-032 parity runner: the active operations of the compatibility register, the verdict and gap
// logic, the target guards, Data API access with the target's server key (fixtures and state checks only), temporary
// accounts, and local process control. Kept free of the flows so its pure parts are unit tested.
import { spawn } from 'node:child_process';
import { deflateSync as deflate } from 'node:zlib';

// Every active operation of docs/contracts/worker-compatibility.md, by group. The World Cup archive (D-02), the HLS
// media route (SL-106) and the local-only media route are outside this gate and deliberately absent.
export const ACTIVE_OPERATIONS = {
  G1: ['GET /health', 'GET /home/dashboard', 'direct divisions+seasons'],
  G2: ['GET /schedule', 'GET /standings', 'GET /teams/:team_id/matches', 'direct matches+match_events'],
  G3: ['GET /teams', 'GET /players', 'GET /players/:player_id', 'GET /leaderboard', 'direct team_entries+roster+players'],
  G4: ['PATCH /wc/flair', 'direct user_profiles', 'direct division_flairs', 'direct my_player+update_my_player'],
  G5: ['POST /predictions/:match_id', 'GET /predictions/:match_id', 'GET /predictions/history', 'GET /predictions/leaderboard', 'POST /admin/predictions/grade', 'POST /admin/predictions/regrade-all'],
  G6: ['GET /admin/matches', 'POST /admin/matches', 'PUT /admin/matches', 'DELETE /admin/matches', 'POST /admin/matches/live', 'POST /captain/team-branding', 'direct captain_update_roster_player'],
  G7: ['GET /news', 'POST /admin/newsletter', 'DELETE /admin/newsletter'],
  G8: ['POST /admin/newsletter/image', 'POST /admin/freshers/player-image', 'POST /captain/team-branding (logo)', 'POST /profile/player-portrait'],
};

// Collects checks as { group, operation, name, pass, observed } and reports, per group, which operations passed,
// failed, or were never exercised (a gap is never a pass).
export function createReport() {
  const checks = [];
  return {
    checks,
    check(group, operation, name, pass, observed = undefined) {
      checks.push({ group, operation, name, pass: Boolean(pass), observed });
      return Boolean(pass);
    },
    summary() {
      return summarize(checks);
    },
  };
}

export function summarize(checks) {
  const groups = {};
  for (const [group, operations] of Object.entries(ACTIVE_OPERATIONS)) {
    const ops = {};
    for (const op of operations) {
      const mine = checks.filter((c) => c.group === group && c.operation === op);
      ops[op] = mine.length === 0 ? 'gap' : mine.every((c) => c.pass) ? 'pass' : 'fail';
    }
    const states = Object.values(ops);
    groups[group] = { status: states.includes('fail') ? 'fail' : states.includes('gap') ? 'gap' : 'pass', operations: ops };
  }
  const unknown = checks.filter((c) => !ACTIVE_OPERATIONS[c.group]?.includes(c.operation)).map((c) => `${c.group} ${c.operation}`);
  const passed = unknown.length === 0 && Object.values(groups).every((g) => g.status === 'pass');
  return { passed, groups, unknownOperations: [...new Set(unknown)] };
}

// Local: this repository's stack only, in both the CLI status and the Worker's own settings.
export function localProblems(status, devVars) {
  const problems = [];
  if (status?.API_URL !== 'http://127.0.0.1:54321') problems.push('the Supabase API is not the local stack on 127.0.0.1:54321');
  if (!String(status?.DB_URL ?? '').includes('127.0.0.1:54322')) problems.push('the database is not the local stack on 54322');
  const workerUrl = /^SUPABASE_URL=(.*)$/m.exec(devVars ?? '')?.[1]?.trim();
  if (workerUrl !== 'http://127.0.0.1:54321') problems.push('api/.dev.vars does not point the Worker at the local stack');
  return problems;
}

// Data API and Auth admin access with the target's server key (fixtures, cleanup and state checks; never the flows
// under test, which go through the site with each caller's own token).
export function serverApi({ url, secretKey, publishableKey }) {
  const headers = { apikey: secretKey, Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' };
  const call = async (path, init = {}) => {
    const res = await fetch(`${url}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  };
  const must = async (path, init) => {
    const r = await call(path, init);
    if (!r.ok) throw new Error(`setup ${init?.method ?? 'GET'} ${path.split('?')[0]} failed (${r.status}): ${JSON.stringify(r.data).slice(0, 200)}`);
    return r.data;
  };
  return {
    call,
    must,
    select: (table, query) => must(`/rest/v1/${table}?${query}`),
    insert: (table, rows) => must(`/rest/v1/${table}`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(rows) }),
    remove: (table, query) => call(`/rest/v1/${table}?${query}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }),
    count: async (table, query) => {
      const res = await fetch(`${url}/rest/v1/${table}?${query}&select=*`, { method: 'HEAD', headers: { ...headers, Prefer: 'count=exact' } });
      return Number(res.headers.get('content-range')?.split('/')[1] ?? NaN);
    },
    // A verified account signed in with a one-time link (no password, no mail).
    async account(email) {
      const created = await must('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, email_confirm: true }) });
      const link = await must('/auth/v1/admin/generate_link', { method: 'POST', body: JSON.stringify({ type: 'magiclink', email }) });
      const verify = await fetch(`${url}/auth/v1/verify`, {
        method: 'POST', headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token ?? link.properties?.hashed_token }),
      });
      const session = await verify.json();
      if (!session.access_token) throw new Error(`could not sign in ${email}`);
      return { id: created.id, email, token: session.access_token, session };
    },
    deleteUser: (id) => call(`/auth/v1/admin/users/${id}`, { method: 'DELETE' }),
    // The screens' direct Data API calls, made as a caller with their own token.
    as(token) {
      const h = { apikey: publishableKey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      return async (path, init = {}) => {
        const res = await fetch(`${url}${path}`, { ...init, headers: { ...h, ...(init.headers || {}) } });
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        return { status: res.status, data };
      };
    },
  };
}

// A valid solid-colour PNG of the given size.
export function png(size) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + size * 3, 0x55); row[0] = 0;
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflate(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Local processes, each in its own group so stopping it stops what pnpm and wrangler started.
export function start(name, cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' }, detached: true });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  return { name, child, output: () => output };
}

export function stop(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.child.exitCode !== null) return resolve();
    const group = (signal) => { try { process.kill(-proc.child.pid, signal); } catch { /* gone */ } };
    proc.child.once('exit', () => resolve());
    group('SIGTERM');
    setTimeout(() => { group('SIGKILL'); resolve(); }, 5000);
  });
}

export async function waitFor(url, proc, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(3000) });
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`${proc.name} did not start at ${url}:\n${proc.output().slice(-1500)}`);
}

// The tagged fixtures every parity run uses, in the current Super League season: accounts with their roles (dictator,
// editor, captain of the home entry, scorer assigned to the match, unassigned scorer, normal user, and the linked
// players of each entry), two teams with their entries, one player on each roster and a scheduled match. Every id is
// recorded in `made` so cleanupFixtures removes it even after a failure.
export async function createFixtures(db, tag, made) {
  const [season] = await db.select('seasons', 'select=id,division_id,divisions!inner(slug)&divisions.slug=eq.super-league&is_current=eq.true');
  if (!season) throw new Error('no current Super League season on the target');
  const who = {};
  for (const [label, roles] of [['dictator', ['dictator']], ['editor', ['editor']], ['captain', ['captain']], ['scorer', ['scorer']], ['loose', ['scorer']], ['normal', []], ['player', []], ['away', []]]) {
    who[label] = await db.account(`sl-check-${tag}-${label}@iiitkottayam.ac.in`);
    made.users.push(who[label].id);
    await db.call('/rest/v1/user_profiles', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: who[label].id, email: who[label].email, nickname: `${label}-${tag}`.slice(0, 20) }) });
    for (const role of roles) await db.insert('user_roles', [{ user_id: who[label].id, role }]);
  }
  const teams = await db.insert('teams', [
    { name: `${tag} Home`, short_name: 'PHM', team_color: '#000000', logo_url: 'data:image/png;base64,AA==' },
    { name: `${tag} Away`, short_name: 'PAW', team_color: '#ffffff', logo_url: 'data:image/png;base64,AA==' },
  ]);
  made.teams.push(...teams.map((t) => t.id));
  const [home, away] = teams;
  const entries = await db.insert('team_entries', [{ team_id: home.id, season_id: season.id }, { team_id: away.id, season_id: season.id }]);
  made.entries.push(...entries.map((e) => e.id));
  const homeEntry = entries.find((e) => e.team_id === home.id);
  const awayEntry = entries.find((e) => e.team_id === away.id);
  await db.insert('captain_assignments', [{ team_entry_id: homeEntry.id, user_id: who.captain.id }]);
  const asDictator = db.as(who.dictator.token);
  const createPlayer = async (user, entry, lastName, jersey) => {
    const r = await asDictator('/rest/v1/rpc/create_player_for_account', { method: 'POST', body: JSON.stringify({ p_user: user, p_team_entry_id: entry, p_first_name: tag, p_last_name: lastName, p_jersey_number: jersey, p_position: null, p_overall_rating: null, p_attributes: null, p_image_url: null }) });
    if (r.status >= 300) throw new Error(`could not create the fixture player (${r.status}): ${JSON.stringify(r.data).slice(0, 200)}`);
    made.players.push(r.data);
    return { data: r.data };
  };
  const linked = await createPlayer(who.player.id, homeEntry.id, 'Linked', 7);
  const awayPlayer = await createPlayer(who.away.id, awayEntry.id, 'Away', 9);
  const [homePlace] = await db.select('roster_memberships', `select=id,position,jersey_number&player_id=eq.${linked.data}`);
  const [awayPlace] = await db.select('roster_memberships', `select=id&player_id=eq.${awayPlayer.data}`);
  const [match] = await db.insert('matches', [{ home_team_id: home.id, away_team_id: away.id, season_id: season.id, status: 'scheduled', date: new Date(Date.now() + 2 * 86400000).toISOString() }]);
  made.matches.push(match.id);
  await db.insert('scorer_assignments', [{ user_id: who.scorer.id, match_id: match.id }]);
  return { season, who, home, away, homeEntry, awayEntry, linked, awayPlayer, homePlace, awayPlace, match };
}

export async function cleanupFixtures(db, made) {
  for (const id of made.matches) await db.remove('matches', `id=eq.${id}`);
  for (const id of made.news) await db.remove('newsletter', `id=eq.${id}`);
  for (const id of made.players) {
    await db.remove('roster_memberships', `player_id=eq.${id}`);
    await db.remove('players', `id=eq.${id}`);
  }
  for (const id of made.entries) await db.remove('team_entries', `id=eq.${id}`);
  for (const id of made.teams) await db.remove('teams', `id=eq.${id}`);
  for (const id of made.users) {
    await db.remove('division_flairs', `user_id=eq.${id}`);
    await db.deleteUser(id);
  }
}

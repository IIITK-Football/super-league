// Group: tooling. scripts/staging-checks.mjs runs security and sign-in checks against the STAGING project with synthetic
// accounts. These tests run it against an in-memory fake of the staging API (nothing remote is contacted): the
// script must refuse any other target, detect a broken staging, always clean up, and never print a key or password.
import { beforeEach, describe, expect, it } from 'vitest';
// @ts-ignore plain ESM
import { loadEnvText, runChecks, verifyTarget } from '../../../scripts/staging-checks.mjs';

const STAGING = 'yecozsiccsfwphlmxozt';
const PROD = 'obkxfepdpdufxawhzaen';
// Built at run time so the source holds no secret-shaped literal.
const SECRET = ['sb', 'secret', 'NEVER_PRINT_THIS_secret_0123456789'].join('_');
const PUBLISHABLE = ['sb', 'publishable', 'NEVER_PRINT_THIS_key_abcdef'].join('_');
const goodEnv = () => ({ SUPABASE_URL: `https://${STAGING}.supabase.co`, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE, SUPABASE_SECRET_KEY: SECRET, ALLOW_REMOTE_SUPABASE: 'true' });

type Opts = { captchaEnforced?: boolean; openRpc?: boolean; failAtRpc?: boolean; leakEmail?: boolean; openDivisions?: boolean; brokenCurrentSeason?: boolean;
  noAudit?: boolean; openAudit?: boolean; editableAudit?: boolean; anySeasonCaptain?: boolean };

function fakeStaging(opts: Opts = {}) {
  const { captchaEnforced = true, openRpc = false, failAtRpc = false, openDivisions = false, brokenCurrentSeason = false } = opts;
  // The append-only audit history: division inserts are recorded with the signed-in actor (absent with noAudit).
  const auditLog = new Map<string, { id: string; actor_id: string | null; table_name: string; record_id: string; action: string }>();
  const users = new Map<string, { id: string; email: string }>();
  const roles = new Map<string, string>();
  const regs = new Map<string, { id: string; captain_id: string }>();
  const regTeams = new Map<string, { team_id: string; season_id: string }>();
  // Rosters: teams, season entries, players (cards), private details and roster places.
  const rows: Record<string, Map<string, any>> = {
    teams: new Map(), team_entries: new Map(), players: new Map(), player_private_details: new Map(), roster_memberships: new Map(),
  };
  const members = rows.roster_memberships;
  const hashes = new Map<string, string>();
  // The seeded legacy divisions, each with a current season; synthetic ones are added by the run.
  const divisions = new Map<string, { id: string; slug: string; visibility: string }>(
    ['super-league', 'wsl', 'freshers'].map((slug, i) => [`d${i}`, { id: `d${i}`, slug, visibility: 'public' }]),
  );
  const sections = new Map<string, { season_id: string; section_key: string }>();
  const seasons = new Map<string, { id: string; division_id: string; is_current: boolean; slug?: string }>(
    ['d0', 'd1', 'd2'].map((d, i) => [`s${i}`, { id: `s${i}`, division_id: d, is_current: true }]),
  );
  const calls: { method: string; url: string; headers: Record<string, string>; body: any }[] = [];
  let n = 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const uid = (auth?: string) => (auth?.startsWith('Bearer at-') ? auth.slice('Bearer at-'.length) : null);

  const fetchImpl = async (url: string, init: any = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const headers: Record<string, string> = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, headers, body });
    if (u.host !== `${STAGING}.supabase.co`) throw new Error(`unexpected host ${u.host}`);
    const p = u.pathname;

    if (p === '/auth/v1/admin/users' && method === 'GET') return json(200, { users: [...users.values()] });
    if (p === '/auth/v1/admin/users' && method === 'POST') {
      if (!/@iiitkottayam\.ac\.in$/.test(body.email)) return json(422, { msg: 'domain' });
      const id = `u${++n}`;
      users.set(id, { id, email: body.email });
      roles.set(id, 'default');
      return json(200, { id, email: body.email });
    }
    const adminUser = p.match(/^\/auth\/v1\/admin\/users\/(.+)$/);
    if (adminUser) {
      const id = adminUser[1];
      if (method === 'GET') return users.has(id) ? json(200, users.get(id)) : json(404, { msg: 'not found' });
      if (method === 'DELETE') {
        users.delete(id);
        roles.delete(id);
        for (const [rid, r] of regs) if (r.captain_id === id) regs.delete(rid);
        return json(200, {});
      }
    }
    if (p === '/auth/v1/admin/generate_link') {
      const user = [...users.values()].find((x) => x.email === body.email);
      if (!user) return json(404, { msg: 'no user' });
      const h = `h-${user.id}-${body.type}`;
      hashes.set(h, user.id);
      return json(200, { hashed_token: h, verification_type: body.type });
    }
    if (p === '/auth/v1/verify') {
      const id = hashes.get(body.token_hash);
      return id ? json(200, { access_token: `at-${id}`, user: { id } }) : json(400, { msg: 'bad token' });
    }
    if (p === '/auth/v1/token') {
      if (captchaEnforced && !body?.gotrue_meta_security?.captcha_token) return json(400, { error_code: 'captcha_failed', msg: 'captcha verification process failed' });
      return json(200, { access_token: 'at-x' });
    }
    if (p === '/auth/v1/user' && method === 'PUT') return uid(headers.authorization) ? json(200, { id: uid(headers.authorization) }) : json(401, {});
    if (p === '/rest/v1/user_roles' && method === 'POST') { roles.set(body.user_id, body.role); return new Response(null, { status: 204 }); }
    if (p === '/rest/v1/user_roles' && method === 'GET') {
      const ids = (u.searchParams.get('user_id') ?? '').replace(/^in\.\(|\)$/g, '').split(',').filter(Boolean);
      return json(200, ids.filter((i) => roles.has(i)).map((i) => ({ user_id: i })));
    }
    if (p === '/rest/v1/team_registrations' && method === 'POST') {
      // Like team_registrations_captain_id_key: an account holds one registration.
      if ([...regs.values()].some((r) => r.captain_id === body.captain_id)) {
        return json(409, { code: '23505', message: 'duplicate key value violates unique constraint "team_registrations_captain_id_key"' });
      }
      const id = `r${++n}`;
      regs.set(id, { id, captain_id: body.captain_id });
      regTeams.set(id, { team_id: body.team_id, season_id: body.season_id });
      return json(201, [{ id }]);
    }
    if (p === '/rest/v1/team_registrations' && method === 'GET') {
      const ids = (u.searchParams.get('captain_id') ?? '').replace(/^in\.\(|\)$/g, '').split(',').filter(Boolean);
      return json(200, [...regs.values()].filter((r) => ids.includes(r.captain_id)).map((r) => ({ id: r.id })));
    }
    // Roster tables. The secret key without a user token administers; a user token gets RLS: public reads of cards
    // and rosters, nothing of private details, and writes for dictators only (none for the run's captains).
    const rosterTable = p.match(/^\/rest\/v1\/(teams|team_entries|players|player_private_details|roster_memberships)$/)?.[1];
    if (rosterTable) {
      const table = rows[rosterTable];
      const asAdmin = !headers.authorization && headers.apikey?.startsWith('sb_secret_');
      const writer = asAdmin || (uid(headers.authorization) !== null && roles.get(uid(headers.authorization)!) === 'dictator');
      const filters = [...u.searchParams.entries()].filter(([k]) => !['select', 'on_conflict'].includes(k));
      const matches = (r: any) => filters.every(([k, v]) => {
        if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
        if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(r[k]));
        if (v.startsWith('like.')) return String(r[k] ?? '').startsWith(v.slice(5).replace(/\*$/, ''));
        return true;
      });
      if (method === 'GET') {
        if (rosterTable === 'player_private_details' && !asAdmin) {
          if (!headers.authorization) return json(401, { code: '42501', message: 'permission denied for table player_private_details' });
          if (!writer) return json(200, []);
        }
        const found = [...table.values()].filter(matches).map((r) => (rosterTable === 'players' && (u.searchParams.get('select') ?? '').includes('roster_memberships')
          ? { ...r, roster_memberships: [...members.values()].filter((m) => m.player_id === r.id).map((m) => ({ id: m.id })) } : r));
        return json(200, found);
      }
      if (!writer) return method === 'POST' ? json(403, { code: '42501', message: `new row violates row-level security policy for table "${rosterTable}"` }) : json(200, []);
      if (method === 'POST') {
        const id = `${rosterTable[0]}${++n}`;
        table.set(id, { id, ...body });
        return json(201, [{ id }]);
      }
      if (method === 'PATCH') { for (const r of [...table.values()].filter(matches)) Object.assign(r, body); return new Response(null, { status: 204 }); }
      if (method === 'DELETE') {
        for (const r of [...table.values()].filter(matches)) {
          table.delete(r.id);
          if (rosterTable === 'players') rows.player_private_details.forEach((d, k) => { if (d.player_id === r.id) rows.player_private_details.delete(k); }); // ON DELETE CASCADE
        }
        return new Response(null, { status: 204 });
      }
    }
    // The member-table function is retired (20261125000000): PostgREST no longer finds it.
    if (p === '/rest/v1/rpc/captain_update_team_member') return json(404, { code: 'PGRST202', message: 'Could not find the function' });
    if (p === '/rest/v1/rpc/captain_update_roster_player') {
      if (failAtRpc) throw new Error('network went away');
      const me = uid(headers.authorization);
      if (!me) return json(401, { code: '42501', message: 'permission denied for function captain_update_roster_player' });
      const m = members.get(body.p_membership_id);
      const role = roles.get(me);
      if (!openRpc) {
        const entry = m ? rows.team_entries.get(m.team_entry_id) : undefined;
        const assigned = entry && [...regs.values()].some((r) => r.captain_id === me && regTeams.get(r.id)?.team_id === entry.team_id && regTeams.get(r.id)?.season_id === m.season_id);
        if (!m || (!assigned && role !== 'dictator')) return json(400, { message: 'Player is not part of your assigned roster' });
        if (role !== 'captain' && role !== 'dictator') return json(400, { message: 'Captain access is required to update players' });
        if (role === 'captain' && !opts.anySeasonCaptain && seasons.get(m.season_id)?.is_current === false) {
          return json(400, { message: 'Only the current season\'s roster can be edited by its captain' });
        }
      }
      if (m) { m.jersey_number = body.p_jersey_number; m.position = body.p_position; }
      return new Response(null, { status: 204 });
    }
    // Divisions and seasons. The secret key without a user token administers; a user token is checked like RLS.
    const isAdmin = !headers.authorization && headers.apikey?.startsWith('sb_secret_');
    const me = uid(headers.authorization);
    const manager = isAdmin || openDivisions || (me !== null && roles.get(me) === 'dictator');
    const inList = (v: string | null) => (v ?? '').replace(/^in\.\(|\)$/g, '').split(',').filter(Boolean);
    const rls = { code: '42501', message: 'new row violates row-level security policy for table "divisions"' };
    if (p === '/rest/v1/divisions') {
      const slugEq = u.searchParams.get('slug')?.match(/^eq\.(.+)$/)?.[1];
      const slugLike = u.searchParams.get('slug')?.match(/^like\.(.+)\*$/)?.[1];
      const ids = inList(u.searchParams.get('id'));
      const match = (d: { id: string; slug: string }) =>
        (!slugEq || d.slug === slugEq) && (!slugLike || d.slug.startsWith(slugLike)) && (!ids.length || ids.includes(d.id));
      if (method === 'GET') return json(200, [...divisions.values()].filter((d) => match(d) && (manager || d.visibility === 'public')));
      if (method === 'POST') {
        if (!manager) return json(403, rls);
        const id = `d${++n}`;
        divisions.set(id, { id, slug: body.slug, visibility: body.visibility ?? 'public' });
        if (!opts.noAudit) { const a = `a${++n}`; auditLog.set(a, { id: a, actor_id: me, table_name: 'divisions', record_id: id, action: 'insert' }); }
        return json(201, [{ id }]);
      }
      if (method === 'DELETE') {
        for (const d of [...divisions.values()]) if (manager && match(d)) divisions.delete(d.id);
        return new Response(null, { status: 204 });
      }
    }
    if (p === '/rest/v1/audit_log') {
      const filters = [...u.searchParams.entries()].filter(([k]) => !['select', 'limit'].includes(k));
      const found = [...auditLog.values()].filter((r: any) => filters.every(([k, v]) => !v.startsWith('eq.') || String(r[k]) === v.slice(3)));
      const refused = json(401, { code: '42501', message: 'permission denied for table audit_log' });
      if (method === 'GET') {
        if (!headers.authorization && !isAdmin && !opts.openAudit) return refused;
        return json(200, isAdmin || opts.openAudit || (me !== null && roles.get(me) === 'dictator') ? found : []);
      }
      if (!opts.editableAudit) return refused;
      if (method === 'PATCH') { found.forEach((r) => Object.assign(r, body)); return new Response(null, { status: 204 }); }
      if (method === 'DELETE') { found.forEach((r) => auditLog.delete(r.id)); return new Response(null, { status: 204 }); }
    }
    if (p === '/rest/v1/seasons') {
      const divisionIds = inList(u.searchParams.get('division_id'));
      if (method === 'GET') {
        const flag = u.searchParams.get('is_current');
        const divisionEq = u.searchParams.get('division_id')?.match(/^eq\.(.+)$/)?.[1];
        return json(200, [...seasons.values()]
          .filter((x) => (!flag || x.is_current === (flag === 'eq.true')) && (!divisionEq || x.division_id === divisionEq))
          .map((x) => ({ id: x.id, division_id: x.division_id })));
      }
      if (method === 'POST') {
        if (!manager) return json(403, rls);
        // Like PostgREST: a bulk insert without ?columns= needs the same keys in every row.
        const keySets = (Array.isArray(body) ? body : [body]).map((b: object) => Object.keys(b).sort().join(','));
        if (!u.searchParams.has('columns') && new Set(keySets).size > 1) return json(400, { code: 'PGRST102', message: 'All object keys must match' });
        const rows = (Array.isArray(body) ? body : [body]).map((b: any) => ({ id: `s${++n}`, division_id: b.division_id, is_current: !!b.is_current, slug: b.slug }));
        for (const r of rows) seasons.set(r.id, r);
        return json(201, rows.map((r) => ({ id: r.id, slug: r.slug })));
      }
      if (method === 'DELETE') {
        for (const x of [...seasons.values()]) if (manager && divisionIds.includes(x.division_id)) {
          seasons.delete(x.id);
          for (const [k, v] of sections) if (v.season_id === x.id) sections.delete(k); // ON DELETE CASCADE
        }
        return new Response(null, { status: 204 });
      }
    }
    if (p === '/rest/v1/rpc/set_current_season' && method === 'POST') {
      if (!manager) return json(403, { code: '42501', message: 'Only a dictator can change the current season' });
      const target = seasons.get(body.p_season);
      if (!target) return json(404, { code: 'P0002', message: 'Season not found' });
      if (!brokenCurrentSeason) for (const x of seasons.values()) if (x.division_id === target.division_id) x.is_current = false;
      target.is_current = true;
      return new Response(null, { status: 204 });
    }
    if (p === '/rest/v1/season_sections' && method === 'POST') {
      if (!manager) return json(403, rls);
      sections.set(`${body.season_id}:${body.section_key}`, { season_id: body.season_id, section_key: body.section_key });
      return json(201, [body]);
    }
    return json(404, { msg: `unhandled ${method} ${p}` });
  };
  return { fetchImpl, users, roles, regs, members, rows, divisions, seasons, sections, calls };
}

let logs: string[];
const log = (s: string) => logs.push(s);
const output = () => logs.join('\n');
const by = (results: { name: string; status: string }[], re: RegExp) => results.find((r) => re.test(r.name));

beforeEach(() => {
  logs = [];
});

describe('verifyTarget', () => {
  it('accepts the staging project with both keys and the explicit remote flag', () => {
    expect(verifyTarget(goodEnv())).toEqual([]);
  });

  it('refuses production, local, an unknown project, a missing flag and missing keys', () => {
    const bad = [
      { ...goodEnv(), SUPABASE_URL: `https://${PROD}.supabase.co` },
      { ...goodEnv(), SUPABASE_URL: 'http://127.0.0.1:54321' },
      { ...goodEnv(), SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' },
      { ...goodEnv(), SUPABASE_URL: `https://${STAGING}.supabase.co.evil.example` },
      { ...goodEnv(), ALLOW_REMOTE_SUPABASE: '' },
      { ...goodEnv(), SUPABASE_SECRET_KEY: '' },
      { ...goodEnv(), SUPABASE_PUBLISHABLE_KEY: '' },
      { ...goodEnv(), SUPABASE_SECRET_KEY: PUBLISHABLE },
    ];
    for (const env of bad) expect(verifyTarget(env).length, JSON.stringify(env).slice(0, 60)).toBeGreaterThan(0);
  });

  it('never includes a key in its messages', () => {
    const msgs = verifyTarget({ ...goodEnv(), SUPABASE_URL: `https://${PROD}.supabase.co` }).join(' ');
    expect(msgs).not.toContain(SECRET);
    expect(msgs).not.toContain(PUBLISHABLE);
  });
});

describe('runChecks refuses a wrong target before any request', () => {
  it('makes no request at all for production', async () => {
    const s = fakeStaging();
    await expect(runChecks({ env: { ...goodEnv(), SUPABASE_URL: `https://${PROD}.supabase.co` }, fetchImpl: s.fetchImpl as unknown as typeof fetch, log })).rejects.toThrow(/refus/i);
    expect(s.calls).toEqual([]);
  });
});

describe('runChecks against a healthy staging', () => {
  it('passes every check, and leaves nothing behind', async () => {
    const s = fakeStaging();
    const results = await runChecks({ env: goodEnv(), fetchImpl: s.fetchImpl as unknown as typeof fetch, log });
    expect(results.filter((r: { status: string }) => r.status === 'FAIL')).toEqual([]);
    for (const re of [/anonymous.*closed/i, /captcha/i, /captain.*own/i, /other team/i, /without the captain role/i, /normal user/i, /rename a player/i, /private player details/i, /dictator/i, /recovery/i, /clean/i,
                      /legacy divisions/i, /new hidden division/i, /current season switches/i, /hidden division is invisible/i, /cannot create a division/i,
                      /recorded in the audit history/i, /audit history is hidden/i, /change or remove audit history/i, /season that is not current/i]) {
      expect(by(results, re)?.status, String(re)).toBe('PASS');
    }
    expect(s.users.size).toBe(0);
    expect(s.regs.size).toBe(0);
    for (const table of ['teams', 'team_entries', 'players', 'player_private_details', 'roster_memberships']) expect(s.rows[table].size, table).toBe(0);
    expect(s.roles.size).toBe(0);
    expect([...s.divisions.values()].map((d) => d.slug).sort()).toEqual(['freshers', 'super-league', 'wsl']); // only the seeded ones remain
    expect(s.seasons.size).toBe(3);
    expect(s.sections.size).toBe(0);
  });

  it('registers synthetic teams in the current Freshers season, never by a division string', async () => {
    const s = fakeStaging();
    await runChecks({ env: goodEnv(), fetchImpl: s.fetchImpl as unknown as typeof fetch, log });
    const regs = s.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/rest/v1/team_registrations'));
    expect(regs.length).toBeGreaterThan(0);
    // Team D is the past-season check, deliberately in a non-current season of the run's own division.
    for (const c of regs.filter((r) => r.body.team_name !== 'SL CHECK D')) {
      expect(c.body.season_id).toBe('s2'); // the fake's current Freshers season
      expect(c.body).not.toHaveProperty('division');
    }
  });

  it('only ever talks to the staging host', async () => {
    const s = fakeStaging();
    await runChecks({ env: goodEnv(), fetchImpl: s.fetchImpl as unknown as typeof fetch, log });
    expect(s.calls.length).toBeGreaterThan(10);
    for (const c of s.calls) expect(new URL(c.url).host).toBe(`${STAGING}.supabase.co`);
  });

  it('creates only synthetic accounts, never sends mail (confirmed on creation), and removes them', async () => {
    const s = fakeStaging();
    await runChecks({ env: goodEnv(), fetchImpl: s.fetchImpl as unknown as typeof fetch, log });
    const creates = s.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/auth/v1/admin/users'));
    expect(creates.length).toBeGreaterThanOrEqual(5);
    for (const c of creates) {
      expect(c.body.email).toMatch(/^sl-check-[a-z0-9-]+@iiitkottayam\.ac\.in$/);
      expect(c.body.email_confirm).toBe(true);
    }
    expect(s.calls.some((c) => /\/auth\/v1\/(recover|otp|signup|resend)/.test(c.url))).toBe(false); // none of the endpoints that send email
  });

  it('uses the secret key only for administration, and a user token with the publishable key for user-level calls', async () => {
    const s = fakeStaging();
    await runChecks({ env: goodEnv(), fetchImpl: s.fetchImpl as unknown as typeof fetch, log });
    for (const c of s.calls.filter((x) => x.url.includes('/rpc/captain_update_roster_player') && x.headers.authorization)) {
      expect(c.headers.apikey).toBe(PUBLISHABLE);
      expect(c.headers.authorization).not.toContain(SECRET);
    }
    for (const c of s.calls) expect(c.headers.authorization ?? '').not.toContain(SECRET); // secret keys travel as apikey only
  });

  it('never prints a key or a password', async () => {
    const s = fakeStaging();
    await runChecks({ env: goodEnv(), fetchImpl: s.fetchImpl as unknown as typeof fetch, log });
    expect(output()).not.toContain(SECRET);
    expect(output()).not.toContain(PUBLISHABLE);
    expect(output()).not.toMatch(/password[^\n]*[:=]\s*\S{8,}/i);
  });
});

describe('runChecks detects a broken staging', () => {
  it('fails the captain checks when the function is open to anyone', async () => {
    const s = fakeStaging({ openRpc: true });
    const results = await runChecks({ env: goodEnv(), fetchImpl: s.fetchImpl as unknown as typeof fetch, log });
    expect(by(results, /other team/i)?.status).toBe('FAIL');
    expect(by(results, /normal user/i)?.status).toBe('FAIL');
    expect(by(results, /without the captain role/i)?.status).toBe('FAIL');
    expect(s.users.size).toBe(0); // and still cleans up
  });

  it('fails the division checks when any account can create divisions and see hidden ones', async () => {
    const s = fakeStaging({ openDivisions: true });
    const results = await runChecks({ env: goodEnv(), fetchImpl: s.fetchImpl as unknown as typeof fetch, log });
    expect(by(results, /hidden division is invisible/i)?.status).toBe('FAIL');
    expect(by(results, /cannot create a division/i)?.status).toBe('FAIL');
    expect([...s.divisions.values()].some((d) => d.slug.startsWith('sl-check-'))).toBe(false); // and still cleans up
  });

  it('fails the past-season check when a captain may edit any season', async () => {
    const s = fakeStaging({ anySeasonCaptain: true });
    const results = await runChecks({ env: goodEnv(), fetchImpl: s.fetchImpl as unknown as typeof fetch, log });
    expect(by(results, /season that is not current/i)?.status).toBe('FAIL');
    expect(s.users.size).toBe(0); // and still cleans up
  });

  it('fails the audit checks when a change is not recorded, the history is readable by anyone, or it can be changed', async () => {
    for (const [opts, re] of [[{ noAudit: true }, /recorded in the audit history/i], [{ openAudit: true }, /audit history is hidden/i], [{ editableAudit: true }, /change or remove audit history/i]] as const) {
      const s = fakeStaging(opts);
      const results = await runChecks({ env: goodEnv(), fetchImpl: s.fetchImpl as unknown as typeof fetch, log });
      expect(by(results, re)?.status, String(re)).toBe('FAIL');
      expect(s.users.size).toBe(0); // and still cleans up
    }
  });

  it('fails the current-season check when switching leaves two current seasons', async () => {
    const s = fakeStaging({ brokenCurrentSeason: true });
    const results = await runChecks({ env: goodEnv(), fetchImpl: s.fetchImpl as unknown as typeof fetch, log });
    expect(by(results, /current season switches/i)?.status).toBe('FAIL');
  });

  it('fails the current-season check when any account may switch it', async () => {
    const s = fakeStaging({ openDivisions: true });
    const results = await runChecks({ env: goodEnv(), fetchImpl: s.fetchImpl as unknown as typeof fetch, log });
    expect(by(results, /current season switches/i)?.status).toBe('FAIL');
  });

  it('fails the legacy division check when the seeded divisions are missing', async () => {
    const s = fakeStaging();
    s.divisions.delete('d1');
    const results = await runChecks({ env: goodEnv(), fetchImpl: s.fetchImpl as unknown as typeof fetch, log });
    expect(by(results, /legacy divisions/i)?.status).toBe('FAIL');
  });

  it('fails the CAPTCHA check when password sign-in works without a token', async () => {
    const s = fakeStaging({ captchaEnforced: false });
    const results = await runChecks({ env: goodEnv(), fetchImpl: s.fetchImpl as unknown as typeof fetch, log });
    expect(by(results, /captcha/i)?.status).toBe('FAIL');
  });

  it('cleans up even when a request throws part-way through, and reports the failure', async () => {
    const s = fakeStaging({ failAtRpc: true });
    const results = await runChecks({ env: goodEnv(), fetchImpl: s.fetchImpl as unknown as typeof fetch, log });
    expect(results.some((r: { status: string }) => r.status === 'FAIL')).toBe(true);
    expect(s.users.size).toBe(0);
    expect(s.regs.size).toBe(0);
  });

  it('removes leftover synthetic accounts from an earlier aborted run before starting', async () => {
    const s = fakeStaging();
    await s.fetchImpl(`https://${STAGING}.supabase.co/auth/v1/admin/users`, { method: 'POST', headers: { apikey: SECRET }, body: JSON.stringify({ email: 'sl-check-old@iiitkottayam.ac.in', password: 'x', email_confirm: true }) });
    await s.fetchImpl(`https://${STAGING}.supabase.co/auth/v1/admin/users`, { method: 'POST', headers: { apikey: SECRET }, body: JSON.stringify({ email: 'lamb@iiitkottayam.ac.in', password: 'x', email_confirm: true }) });
    await runChecks({ env: goodEnv(), fetchImpl: s.fetchImpl as unknown as typeof fetch, log });
    const left = [...s.users.values()].map((u) => u.email);
    expect(left).toEqual(['lamb@iiitkottayam.ac.in']); // seeded and real accounts are never touched
  });
});

describe('loadEnvText', () => {
  it('reads values for the script only, never exposing them in an error', () => {
    const env = loadEnvText(`# c\nSUPABASE_URL=https://${STAGING}.supabase.co\nexport SUPABASE_SECRET_KEY="${SECRET}"\nALLOW_REMOTE_SUPABASE='true'\n`) as Record<string, string>;
    expect(env.SUPABASE_SECRET_KEY).toBe(SECRET);
    expect(env.ALLOW_REMOTE_SUPABASE).toBe('true');
  });
});

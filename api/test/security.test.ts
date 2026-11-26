// Group: api-services. SL-025 through the real local Auth, Data API and Worker: profile emails are unreadable by
// visitors and signed-in users; a user changes only their own profile and never its email or id; visitors cannot write
// anything; the World Cup flair route needs a session and changes only the caller's own flair.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createApp } from '../src/app';
import { clients, localJwtSecret, localKeys, uniqueEmail } from '../../backend/tests/auth/local-supabase';

const keys = localKeys();
const c = clients(keys);
const admin = c.admin;
let app: ReturnType<typeof createApp>;
const users: { id: string; email: string; token: string }[] = [];

async function account(label: string) {
  const email = uniqueEmail(`sec-${label}`);
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const v = await c.anon().auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'magiclink' });
  if (v.error) throw v.error;
  const u = { id: data.user.id, email, token: v.data.session!.access_token };
  users.push(u);
  return u;
}
const as = (token: string) => createClient(keys.url, keys.publishable, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });

let alice: Awaited<ReturnType<typeof account>>;
let bob: Awaited<ReturnType<typeof account>>;

beforeAll(async () => {
  Object.assign(process.env, { SUPABASE_URL: keys.url, SUPABASE_PUBLISHABLE_KEY: keys.publishable, SUPABASE_SECRET_KEY: keys.secret, SL_ENVIRONMENT: 'local' });
  app = createApp();
  alice = await account('alice');
  bob = await account('bob');
}, 60000);

afterAll(async () => {
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
}, 30000);

describe('profile privacy and ownership', () => {
  it('visitors and signed-in users cannot read profile emails, but can read public profile fields', async () => {
    const anonEmail = await c.anonWithoutCaptcha().from('user_profiles').select('email').limit(1);
    expect(anonEmail.error?.message).toMatch(/permission denied/);
    const ownEmail = await as(alice.token).from('user_profiles').select('email').eq('id', alice.id);
    expect(ownEmail.error?.message).toMatch(/permission denied/);
    const pub = await c.anonWithoutCaptcha().from('user_profiles').select('id, nickname').eq('id', alice.id);
    expect(pub.error).toBeNull();
    expect(pub.data).toHaveLength(1);
  });

  it('a user changes their own nickname but never their email', async () => {
    const ok = await as(alice.token).from('user_profiles').update({ nickname: 'Alice' }).eq('id', alice.id).select('nickname');
    expect(ok.error).toBeNull();
    expect(ok.data?.[0]?.nickname).toBe('Alice');
    const email = await as(alice.token).from('user_profiles').update({ email: 'stolen@iiitkottayam.ac.in' }).eq('id', alice.id);
    expect(email.error?.message).toMatch(/permission denied/);
    const stored = await admin.from('user_profiles').select('email').eq('id', alice.id).single();
    expect(stored.data?.email).toBe(alice.email);
  });

  it("a user cannot change someone else's profile", async () => {
    const res = await as(alice.token).from('user_profiles').update({ nickname: 'Hacked' }).eq('id', bob.id).select('id');
    expect(res.data ?? []).toHaveLength(0);
    expect((await admin.from('user_profiles').select('nickname').eq('id', bob.id).single()).data?.nickname).not.toBe('Hacked');
  });

  it('visitors cannot write any table', async () => {
    const res = await c.anonWithoutCaptcha().from('newsletter').insert({ title: 'x' });
    expect(res.error?.message).toMatch(/permission denied/);
  });
});

describe('Worker route authorization', () => {
  it.each(['/admin/predictions/grade', '/admin/predictions/regrade-all'])(
    '%s requires a dictator grant',
    async (path) => {
      const response = await app.request(`http://localhost/api${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ match_id: alice.id }),
      });
      expect(response.status).toBe(403);
    },
  );

  it.each(['/matches/update', '/wc/sync/manual', '/wc/grade/groups'])('%s stays retired', async (path) => {
    expect((await app.request(`http://localhost/api${path}`)).status).toBe(404);
  });
});

// SL-030 (D-04): the session check runs before any handler, so a missing, expired or tampered token is refused with
// 401 and nothing is stored; a valid caller without the grant is refused by the handler and nothing is stored; a
// dictator's write records the dictator as its actor; a failed multi-write leaves nothing behind.
describe('Worker session, actor and atomicity', () => {
  const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');
  const sign = (payload: Record<string, unknown>) => {
    const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = b64url(JSON.stringify(payload));
    return `${head}.${body}.${createHmac('sha256', localJwtSecret()).update(`${head}.${body}`).digest('base64url')}`;
  };
  const claims = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  let dictator: Awaited<ReturnType<typeof account>>;
  let seasonId = '';
  let teams: string[] = [];
  const created: string[] = [];

  beforeAll(async () => {
    dictator = await account('dictator');
    const r = await admin.from('user_roles').insert({ user_id: dictator.id, role: 'dictator' });
    if (r.error) throw r.error;
    const { data: season } = await admin.from('seasons').select('id, division:divisions!inner(slug)').eq('division.slug', 'super-league').eq('is_current', true).single();
    seasonId = season!.id;
    teams = ((await admin.from('team_entries').select('team_id').eq('season_id', seasonId).limit(2)).data ?? []).map((e) => e.team_id);
    expect(teams).toHaveLength(2);
  }, 60000);
  afterAll(async () => {
    if (created.length) await admin.from('matches').delete().in('id', created);
  });

  const matchCount = async () => (await admin.from('matches').select('id', { count: 'exact', head: true }).eq('season_id', seasonId)).count;
  const createMatch = (authorization: string | null, extra: Record<string, unknown> = {}) =>
    app.request('http://localhost/api/admin/matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
      body: JSON.stringify({ division: 'super-league', home_team_id: teams[0], away_team_id: teams[1], date: '2030-01-01T10:00:00Z', ...extra }),
    });

  it('refuses missing, malformed, expired and tampered tokens with 401 and stores nothing', async () => {
    const before = await matchCount();
    const real = claims(alice.token);
    const expired = sign({ ...real, iat: 1_600_000_000, exp: 1_600_003_600 });
    const [head, , sig] = alice.token.split('.');
    const tampered = `${head}.${b64url(JSON.stringify({ ...real, role: 'service_role' }))}.${sig}`;
    for (const authorization of [null, 'Basic abc', 'Bearer not-a-token', `Bearer ${expired}`, `Bearer ${tampered}`]) {
      const res = await createMatch(authorization);
      expect(res.status, String(authorization).slice(0, 20)).toBe(401);
    }
    expect(await matchCount()).toBe(before);
  });

  it('a valid caller without the dictator grant is refused by the database and stores nothing', async () => {
    const before = await matchCount();
    const res = await createMatch(`Bearer ${alice.token}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await matchCount()).toBe(before);
  });

  it("a dictator's write is recorded with the dictator as its actor", async () => {
    const res = await createMatch(`Bearer ${dictator.token}`);
    expect(res.status).toBe(200);
    const id = (await res.json()).data.id;
    created.push(id);
    const { data: audit } = await admin.from('audit_log').select('actor_id, action').eq('table_name', 'matches').eq('record_id', id);
    expect(audit).toEqual([{ actor_id: dictator.id, action: 'insert' }]);
    expect(res.headers.get('Server-Timing')).toMatch(/rounds=\d+/);
  });

  it('a multi-write that fails part-way leaves nothing behind', async () => {
    const before = await matchCount();
    const res = await createMatch(`Bearer ${dictator.token}`, { is_walkover: true, walkover_winner: 'home', walkover_reason: 'x', awarded_home: -1, awarded_away: 0 });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await matchCount()).toBe(before);
  });
});

describe('World Cup flair route', () => {
  const patch = (token: string | null, body: unknown) =>
    app.request('http://localhost/api/wc/flair', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  it('needs a session', async () => {
    expect((await patch(null, { user_id: alice.id, wc_team_flair: 'Brazil' })).status).toBe(401);
  });

  it("refuses to change another user's flair", async () => {
    expect((await patch(alice.token, { user_id: bob.id, wc_team_flair: 'Brazil' })).status).toBe(403);
    expect((await admin.from('user_profiles').select('wc_team_flair').eq('id', bob.id).single()).data?.wc_team_flair).not.toBe('Brazil');
  });

  it("changes the caller's own flair", async () => {
    const res = await patch(alice.token, { user_id: alice.id, wc_team_flair: 'Argentina' });
    expect(res.status).toBe(200);
    expect((await admin.from('user_profiles').select('wc_team_flair').eq('id', alice.id).single()).data?.wc_team_flair).toBe('Argentina');
  });
});

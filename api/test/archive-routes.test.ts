// Group: api-services. The public news route and the World Cup archive routes (frozen, D-02) through the Worker, against
// THIS repository's local Supabase stack: their current behaviour is pinned, not changed. News pages and filters by
// category; the World Cup reads answer with their data; every World Cup submission is refused since the deadline;
// malformed requests keep their 400 answers; writes still need a session.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { clients, localKeys, uniqueEmail } from '../../backend/tests/auth/local-supabase';

const keys = localKeys();
const admin = clients(keys).admin;
let app: ReturnType<typeof createApp>;
let token = '';
let userId = '';
const newsIds: string[] = [];
const tag = `arch${Date.now().toString(36)}`;

beforeAll(async () => {
  Object.assign(process.env, { SUPABASE_URL: keys.url, SUPABASE_PUBLISHABLE_KEY: keys.publishable, SUPABASE_SECRET_KEY: keys.secret, SL_ENVIRONMENT: 'local' });
  app = createApp();
  const email = uniqueEmail('archive');
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const v = await clients(keys).anon().auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'magiclink' });
  if (v.error) throw v.error;
  token = v.data.session!.access_token;
  const rows = [
    { title: `${tag} a`, summary: 's', category: `${tag}-cat`, date: '2030-01-02T00:00:00Z' },
    { title: `${tag} b`, summary: 's', category: `${tag}-cat`, date: '2030-01-01T00:00:00Z' },
  ];
  const ins = await admin.from('newsletter').insert(rows).select('id');
  if (ins.error) throw ins.error;
  newsIds.push(...ins.data.map((r) => r.id));
}, 60000);

afterAll(async () => {
  if (newsIds.length) await admin.from('newsletter').delete().in('id', newsIds);
  if (userId) await admin.auth.admin.deleteUser(userId);
}, 30000);

const get = (path: string) => app.request(`http://localhost/api${path}`);
const post = (path: string, body: unknown, withSession = true) =>
  app.request(`http://localhost/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(withSession ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

describe('news', () => {
  it('lists news newest first with paging metadata', async () => {
    const res = await get('/news?limit=5');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeLessThanOrEqual(5);
    expect(typeof body.meta.total_items).toBe('number');
  });

  it('filters by category and pages the results', async () => {
    const first = await (await get(`/news?category=${tag}-cat&limit=1&page=1`)).json();
    expect(first.data.map((n: { title: string }) => n.title)).toEqual([`${tag} a`]);
    expect(first.meta.total_items).toBe(2);
    const second = await (await get(`/news?category=${tag}-cat&limit=1&page=2`)).json();
    expect(second.data.map((n: { title: string }) => n.title)).toEqual([`${tag} b`]);
  });
});

describe('World Cup archive reads', () => {
  it.each(['/wc/teams', '/wc/leaderboard', '/wc/players?q=zz-no-such-player'])('%s answers with its data', async (path) => {
    const res = await get(path);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('serves the team list the bracket draws from', async () => {
    const body = await (await get('/wc/teams')).json();
    expect(body.data.length).toBeGreaterThan(0);
  });

  it.each(['/wc/predictions/groups', '/wc/predictions/awards', '/wc/predictions/knockouts'])('%s needs a user id (400)', async (path) => {
    expect((await get(path)).status).toBe(400);
  });

  it('answers an empty saved bracket for a user who never predicted', async () => {
    const res = await get(`/wc/predictions/knockouts?user_id=${userId}`);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toBeNull();
  });

  it('keeps answering bracket preflight requests', async () => {
    expect((await app.request('http://localhost/api/wc/predictions/knockouts', { method: 'OPTIONS' })).status).toBe(200);
  });
});

// D-04 downscope (2026-11-26): these reads moved from the secret key to the publishable key. Their response must equal
// what the secret key reads for the same query, so the archive is unchanged.
describe('World Cup reads without the secret key', () => {
  it('/wc/teams returns exactly the rows the secret key reads', async () => {
    const expected = await admin.from('wc_teams').select('id, name, logo_url, group_name').not('group_name', 'is', null)
      .order('group_name', { ascending: true }).order('name', { ascending: true });
    expect(expected.error).toBeNull();
    const body = await (await get('/wc/teams')).json();
    expect(body.data).toEqual(expected.data);
  });

  // The route then rebuilds the bracket by calling its own URL over HTTP, which has no server under app.request (an
  // archive bracket-rendering bug outside the parity gate, D-02); its saved-bracket read is compared directly.
  it('the saved-bracket read returns the same rows with the publishable key', async () => {
    const full = await admin.from('wc_knockout_predictions').select('*').order('user_id');
    const pub = await clients(keys).anonWithoutCaptcha().from('wc_knockout_predictions').select('*').order('user_id');
    expect(full.error).toBeNull();
    expect(pub.error).toBeNull();
    expect(pub.data).toEqual(full.data);
  });
});

describe('World Cup archive writes', () => {
  it('a refused submission changes nothing, whatever user_id it names', async () => {
    const counts = async () => Promise.all(['wc_group_predictions', 'wc_award_predictions', 'wc_knockout_predictions']
      .map(async (t) => (await admin.from(t).select('*', { count: 'exact', head: true })).count));
    const before = await counts();
    await post('/wc/predictions/groups', { user_id: userId, predictions: [{ group_name: 'A', first: 1, second: 2 }] });
    await post('/wc/predictions/awards', { user_id: userId, golden_boot_id: 1 });
    await post('/wc/predictions/knockouts/submit', { user_id: userId, predictions: { champion_id: 1 } });
    expect(await counts()).toEqual(before);
  });

  it.each([
    ['/wc/predictions/groups', { user_id: 'x', predictions: [] }],
    ['/wc/predictions/awards', { user_id: 'x' }],
    ['/wc/predictions/knockouts/submit', { user_id: 'x' }],
  ])('%s refuses every submission since the deadline (403)', async (path, body) => {
    const res = await post(path, body);
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toMatch(/Deadline passed/);
  });

  it('the bracket generator still rejects a malformed request (400)', async () => {
    expect((await post('/wc/predictions/knockouts/generate', { user_id: userId, advancing_third_place_groups: ['A'] })).status).toBe(400);
  });

  it('writes still need a session', async () => {
    expect((await post('/wc/predictions/groups', { user_id: 'x' }, false)).status).toBe(401);
  });
});

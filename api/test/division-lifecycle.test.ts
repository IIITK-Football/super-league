import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { clients, localKeys, uniqueEmail } from '../../backend/tests/auth/local-supabase';

const keys = localKeys();
const { admin, anonWithoutCaptcha } = clients(keys);
const users: string[] = [];
const tag = `lifecycle-${Date.now().toString(36)}`;
const tokens = new Map<string, string>();
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  Object.assign(process.env, {
    SUPABASE_URL: keys.url, SUPABASE_PUBLISHABLE_KEY: keys.publishable,
    SUPABASE_SECRET_KEY: keys.secret, SL_ENVIRONMENT: 'local',
  });
  app = createApp();
  for (const role of ['dictator', 'captain', 'scorer', 'editor', 'normal']) {
    const email = uniqueEmail(`lifecycle-${role}`);
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    users.push(data.user.id);
    if (role !== 'normal') {
      const grant = await admin.from('user_roles').insert({ user_id: data.user.id, role });
      if (grant.error) throw grant.error;
    }
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (link.error) throw link.error;
    const verified = await anonWithoutCaptcha().auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' });
    if (verified.error) throw verified.error;
    tokens.set(role, verified.data.session!.access_token);
  }
}, 60000);

afterAll(async () => {
  const { data } = await admin.from('divisions').select('id').like('slug', `${tag}%`);
  const ids = (data ?? []).map(({ id }) => id);
  if (ids.length) {
    await admin.from('seasons').delete().in('division_id', ids);
    await admin.from('divisions').delete().in('id', ids);
  }
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 30000);

async function call(path: string, method = 'GET', body?: unknown, role = 'dictator') {
  const token = tokens.get(role);
  return app.request(`http://localhost/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

it('writes the full lifecycle as the dictator and preserves stored state on denial', async () => {
  const draft = { slug: tag, name: 'Lifecycle Test' };
  const create = await call('/admin/divisions', 'POST', draft);
  expect(create.status).toBe(201);
  const division = (await create.json()).data;
  const divisionPath = `/admin/divisions/${division}`;
  const other = await call('/admin/divisions', 'POST', { slug: `${tag}-empty`, name: 'Empty' });
  expect(other.status).toBe(201);
  const empty = (await other.json()).data;
  const first = await call('/admin/seasons', 'POST', { division_id: division, slug: 'first', name: 'First' });
  expect(first.status).toBe(201);
  const season = (await first.json()).data;
  const second = await call('/admin/seasons', 'POST', { division_id: division, slug: 'second', name: 'Second' });
  expect(second.status).toBe(201);
  const secondId = (await second.json()).data;
  const seasonPath = `/admin/seasons/${season}`;
  const { data: sectionTypes } = await admin.from('section_types').select('key, default_enabled');
  const settings = sectionTypes!.map(({ key, default_enabled }) => ({
    section_key: key, enabled: default_enabled && key !== 'teams', nav_visible: false,
  }));
  const { data: existing } = await admin.from('divisions').select('id').order('sort_order');
  const order = [empty, division, ...existing!.map(({ id }) => id).filter((id) => id !== empty && id !== division)];

  const denied = [
    ['/admin/divisions', 'POST', { ...draft, slug: `${tag}-denied` }],
    [divisionPath, 'PATCH', { name: 'Denied' }],
    [`${divisionPath}/current`, 'POST', undefined],
    [`/admin/divisions/${empty}`, 'DELETE', undefined],
    ['/admin/divisions/order', 'PUT', { ids: order }],
    ['/admin/seasons', 'POST', { division_id: division, slug: 'denied', name: 'Denied' }],
    [seasonPath, 'PATCH', { visibility: 'public' }],
    [`${seasonPath}/current`, 'POST', undefined],
    [`${seasonPath}/sections`, 'PUT', { sections: settings }],
    ['/admin/seasons/order', 'PUT', { division_id: division, ids: [secondId, season] }],
  ] as const;
  for (const role of ['captain', 'scorer', 'editor', 'normal', 'visitor']) {
    for (const [path, method, body] of denied) {
      expect((await call(path, method, body, role)).status, `${role} ${method} ${path}`).toBe(role === 'visitor' ? 401 : 403);
    }
  }
  expect((await admin.from('divisions').select('name, visibility').eq('id', division).single()).data)
    .toEqual({ name: draft.name, visibility: 'hidden' });
  expect((await admin.from('seasons').select('visibility, is_current').eq('id', season).single()).data)
    .toEqual({ visibility: 'hidden', is_current: false });
  const before = (await admin.from('divisions').select('id, sort_order').order('id')).data;
  const badOrder = await call('/admin/divisions/order', 'PUT', { ids: [division, division] });
  expect(badOrder.status).toBe(400);
  expect((await admin.from('divisions').select('id, sort_order').order('id')).data).toEqual(before);
  expect((await call('/admin/divisions/order', 'PUT', { ids: existing!.map(({ id }) => id) })).status).toBe(200);
  expect((await call('/admin/seasons/order', 'PUT', { division_id: division, ids: [secondId, season] })).status).toBe(200);
  expect((await call(`${seasonPath}/current`, 'POST')).status).toBe(400);
  expect((await call(divisionPath, 'PATCH', { visibility: 'public' })).status).toBe(200);
  expect((await call(seasonPath, 'PATCH', { visibility: 'public' })).status).toBe(200);
  expect((await call(`${seasonPath}/current`, 'POST')).status).toBe(200);
  const invalid = await call(seasonPath, 'PATCH', { name: 'Should Roll Back', starts_on: '2026-10-01', ends_on: '2026-09-01' });
  expect(invalid.status).toBe(400);
  expect((await admin.from('seasons').select('name').eq('id', season).single()).data?.name).toBe('First');
  expect((await call(`${seasonPath}/sections`, 'PUT', { sections: settings })).status).toBe(200);
  const audit = await admin.from('audit_log').select('actor_id').eq('table_name', 'seasons')
    .eq('record_id', season).order('id', { ascending: false }).limit(1).single();
  expect(audit.data?.actor_id).toBe(users[0]);
  const teams = await call(`/teams?division=${tag}`, 'GET', undefined, 'visitor');
  expect(teams.status).toBe(404);
  expect((await teams.json()).message).toMatch(/section is not available/);
  const fixtures = await call(`/schedule?division=${tag}`, 'GET', undefined, 'visitor');
  expect(fixtures.status).toBe(200);
  expect(fixtures.headers.get('Server-Timing')).toMatch(/rounds=[1-3]\b/);
  expect((await call(seasonPath, 'PATCH', { archived: true })).status).toBe(200);
  expect((await call(seasonPath, 'PATCH', { archived: false })).status).toBe(200);
  expect((await admin.from('seasons').select('visibility, is_current, archived_at').eq('id', season).single()).data)
    .toEqual({ visibility: 'hidden', is_current: false, archived_at: null });
  expect((await call(divisionPath, 'DELETE')).status).toBe(409);
  expect((await call(`/admin/divisions/${empty}`, 'DELETE')).status).toBe(200);
}, 60000);

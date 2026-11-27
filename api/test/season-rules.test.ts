// Group: api-services. The rules routes against THIS repository's local stack: the dictator builds, publishes and reads
// history; every other caller is refused with nothing stored; visitors read the latest published version only.
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { clients, localKeys, uniqueEmail } from '../../backend/tests/auth/local-supabase';

const keys = localKeys();
const { admin, anonWithoutCaptcha } = clients(keys);
const users = new Map<string, { id: string; token: string }>();
const tag = `rules-${Date.now().toString(36)}`;
let app: ReturnType<typeof createApp>;
let season = '';

beforeAll(async () => {
  Object.assign(process.env, {
    SUPABASE_URL: keys.url, SUPABASE_PUBLISHABLE_KEY: keys.publishable,
    SUPABASE_SECRET_KEY: keys.secret, SL_ENVIRONMENT: 'local',
  });
  app = createApp();
  for (const role of ['dictator', 'captain', 'scorer', 'editor', 'normal']) {
    const email = uniqueEmail(`rules-${role}`);
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    if (role !== 'normal') {
      const grant = await admin.from('user_roles').insert({ user_id: data.user.id, role });
      if (grant.error) throw grant.error;
    }
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (link.error) throw link.error;
    const verified = await anonWithoutCaptcha().auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' });
    if (verified.error) throw verified.error;
    users.set(role, { id: data.user.id, token: verified.data.session!.access_token });
  }
  const division = await admin.from('divisions').insert({ slug: tag, name: 'Rules Test', visibility: 'public' }).select('id').single();
  if (division.error) throw division.error;
  const created = await admin.from('seasons')
    .insert({ division_id: division.data.id, slug: 'first', name: 'First', visibility: 'public' }).select('id').single();
  if (created.error) throw created.error;
  season = created.data.id;
}, 60000);

afterAll(async () => {
  // Published versions are immutable for every role, so the fixture is removed with the triggers off (local only).
  if (season) {
    spawnSync('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-c',
      `SET session_replication_role = replica;
       DELETE FROM public.season_rules_versions WHERE season_id = '${season}';
       DELETE FROM public.season_rules_drafts WHERE season_id = '${season}';`]);
  }
  const { data } = await admin.from('divisions').select('id').eq('slug', tag);
  for (const { id } of data ?? []) {
    await admin.from('seasons').delete().eq('division_id', id);
    await admin.from('divisions').delete().eq('id', id);
  }
  for (const { id } of users.values()) await admin.auth.admin.deleteUser(id);
}, 30000);

function call(path: string, method = 'GET', body?: unknown, role: string | null = 'dictator') {
  const token = role ? users.get(role)!.token : null;
  return app.request(`http://localhost/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const notice = (body: string, id = 'a', hidden = false) => ({ id, type: 'notice', hidden, tone: 'info', body });
const publicRules = async () => (await (await call(`/rules?division=${tag}&season=first`, 'GET', undefined, null)).json()).data.rules;

it('refuses everyone but a dictator, storing nothing', async () => {
  const base = `/admin/seasons/${season}/rules`;
  for (const role of ['captain', 'scorer', 'editor', 'normal', null]) {
    const expected = role ? 403 : 401;
    expect((await call(base, 'GET', undefined, role)).status, `${role} read`).toBe(expected);
    expect((await call(`${base}/draft`, 'PUT', { blocks: [notice('x')] }, role)).status, `${role} save`).toBe(expected);
    expect((await call(`${base}/publish`, 'POST', undefined, role)).status, `${role} publish`).toBe(expected);
    expect((await call(`${base}/versions/1`, 'GET', undefined, role)).status, `${role} history`).toBe(expected);
  }
  const stored = await admin.from('season_rules_drafts').select('season_id').eq('season_id', season);
  expect(stored.data).toEqual([]);
});

it('saves, publishes and keeps earlier versions while visitors read only the latest', async () => {
  const base = `/admin/seasons/${season}/rules`;
  expect(await publicRules()).toBeNull();
  expect((await call(`${base}/draft`, 'PUT', { blocks: [{ id: 'a', type: 'html', hidden: false }] })).status).toBe(400);
  expect((await call(`${base}/draft`, 'PUT', {})).status).toBe(400);
  expect((await call(`${base}/publish`, 'POST')).status).toBe(400);

  expect((await call(`${base}/draft`, 'PUT', { blocks: [notice('First'), notice('Secret', 'b', true)] })).status).toBe(200);
  expect(await publicRules()).toBeNull();
  const published = await call(`${base}/publish`, 'POST');
  expect((await published.json()).data).toEqual({ version: 1 });
  expect((await publicRules()).blocks).toEqual([notice('First')]);

  await call(`${base}/draft`, 'PUT', { blocks: [notice('Second')] });
  expect((await publicRules()).blocks).toEqual([notice('First')]);
  await call(`${base}/publish`, 'POST');
  expect(await publicRules()).toMatchObject({ version: 2, blocks: [notice('Second')] });

  const first = await call(`${base}/versions/1`);
  expect((await first.json()).data.blocks).toEqual([notice('First')]);
  expect((await call(`${base}/versions/9`)).status).toBe(404);
  const state = (await (await call(base)).json()).data;
  expect(state.draft.based_on_version).toBe(2);
  expect(state.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);

  const audit = await admin.from('audit_log').select('actor_id').eq('table_name', 'season_rules_versions')
    .like('record_id', `${season}%`);
  expect(audit.data).toEqual([{ actor_id: users.get('dictator')!.id }, { actor_id: users.get('dictator')!.id }]);
});

it('answers within three rounds, and 404 once the section or the season is unavailable', async () => {
  const res = await call(`/rules?division=${tag}&season=first`, 'GET', undefined, null);
  expect(Number(/rounds=(\d+)/.exec(res.headers.get('Server-Timing') ?? '')?.[1])).toBeLessThanOrEqual(3);
  await admin.from('season_sections').upsert({ season_id: season, section_key: 'rules', enabled: false, nav_visible: false, sort_order: 11 });
  expect((await call(`/rules?division=${tag}&season=first`, 'GET', undefined, null)).status).toBe(404);
  await admin.from('season_sections').delete().eq('season_id', season);
  await admin.from('seasons').update({ visibility: 'hidden' }).eq('id', season);
  expect((await call(`/rules?division=${tag}&season=first`, 'GET', undefined, null)).status).toBe(404);
});

// Group: auth-roles. A captain edits the name, short name and colour of the team they captain, in any division, in a
// current or upcoming season. Another team, an assignment without the captain grant and a completed season are
// refused and change nothing; the dictator names the entry. Captains never create, rename or remove players.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { account, cleanup, startFixture, world } from './fixture';

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
// A name or colour update never uploads a logo, so it needs no media storage at all.

const f = startFixture();
let w: Awaited<ReturnType<typeof world>>;
const who: Record<string, Awaited<ReturnType<typeof account>>> = {};
const tag = `td${Date.now().toString(36)}`;

async function save(token: string, fields: Record<string, string>) {
  const { POST } = await import('../../app/api/captain/team-branding/route');
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const res = await POST(new Request('http://localhost/api/captain/team-branding', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }));
  return { status: res.status, body: await res.json() };
}
const team = async (id: string) => (await f.admin.from('teams').select('name, short_name, team_color').eq('id', id).single()).data!;

beforeAll(async () => {
  const keys = f.keys;
  Object.assign(process.env, { SUPABASE_URL: keys.url, SUPABASE_PUBLISHABLE_KEY: keys.publishable, SUPABASE_SECRET_KEY: keys.secret });
  w = await world(f, tag);
  await f.admin.from('teams').update({ logo_url: 'data:image/png;base64,AA==', team_color: '#000000' }).in('id', w.teams);
  who.dictator = await account(f, 'dictator', ['dictator']);
  who.captain = await account(f, 'captain', ['captain']);
  who.noGrant = await account(f, 'no-grant');
  who.pastCaptain = await account(f, 'past', ['captain']);
  const rows = [
    { team_entry_id: w.entries.cur[0], user_id: who.captain.id },
    { team_entry_id: w.entries.cur[1], user_id: who.noGrant.id }, // assigned, but holds no captain grant
    { team_entry_id: w.entries.old[0], user_id: who.pastCaptain.id }, // a completed season
  ];
  const r = await f.admin.from('captain_assignments').insert(rows);
  if (r.error) throw r.error;
}, 120000);
afterAll(async () => cleanup(f), 60000);

describe('team details', () => {
  it('a captain edits their own team: name, short name and colour', async () => {
    const r = await save(who.captain.token, { team_name: `${tag} Reds United`, short_name: 'ru', team_color: '#123456' });
    expect(r.status).toBe(200);
    expect(await team(w.teams[0])).toEqual({ name: `${tag} Reds United`, short_name: 'RU', team_color: '#123456' });
  });

  it('only exposes the caller’s assignment when resolving the team to edit', async () => {
    const { data, error } = await who.captain.db
      .from('captain_assignments')
      .select('team_entry_id')
      .in('team_entry_id', w.entries.cur);
    expect(error).toBeNull();
    expect(data).toEqual([{ team_entry_id: w.entries.cur[0] }]);
  });

  it('omitted fields keep their value, and invalid ones are refused without changes', async () => {
    expect((await save(who.captain.token, { team_color: '#654321' })).status).toBe(200);
    expect((await team(w.teams[0])).name).toBe(`${tag} Reds United`);
    for (const bad of [{ team_color: 'red' }, { team_color: '#111111', team_name: 'x' }, { team_color: '#111111', short_name: 'toolong1' }] as Record<string, string>[]) {
      expect((await save(who.captain.token, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await team(w.teams[0])).team_color).toBe('#654321');
  });

  it('refuses an assignment without the captain grant, and a completed season, changing nothing', async () => {
    const before = await team(w.teams[1]);
    expect((await save(who.noGrant.token, { team_color: '#abcdef' })).status).toBe(403);
    expect((await save(who.pastCaptain.token, { team_color: '#abcdef' })).status).toBe(409);
    expect(await team(w.teams[1])).toEqual(before);
  });

  it('refuses a captain naming another team entry, and a caller who is not signed in', async () => {
    const r = await save(who.captain.token, { team_color: '#abcdef', team_entry_id: w.entries.cur[1] });
    expect(r.status).toBe(409);
    const { POST } = await import('../../app/api/captain/team-branding/route');
    const form = new FormData(); form.set('team_color', '#abcdef');
    expect((await POST(new Request('http://localhost/x', { method: 'POST', body: form }))).status).toBe(401);
  });

  it('the dictator names the entry; without one the request is refused', async () => {
    expect((await save(who.dictator.token, { team_color: '#00ff00' })).status).toBe(400);
    expect((await save(who.dictator.token, { team_color: '#00ff00', team_entry_id: w.entries.cur[1] })).status).toBe(200);
    expect((await team(w.teams[1])).team_color).toBe('#00ff00');
  });
});

describe('captains and players', () => {
  it('a captain cannot create, rename, link or remove players, or edit a roster place directly', async () => {
    const create = await who.captain.db.rpc('create_player_for_account', { p_user: who.captain.id, p_team_entry_id: w.entries.cur[0], p_first_name: 'No', p_last_name: 'Way' });
    expect(create.error).not.toBeNull();
    const direct = await who.captain.db.from('players').insert({ first_name: 'No', last_name: 'Way', user_id: who.captain.id });
    expect(direct.error).not.toBeNull();
    const link = await who.captain.db.rpc('link_player_account', { p_player: '00000000-0000-4000-8000-000000000000', p_user: who.captain.id });
    expect(link.error).not.toBeNull();
    const remove = await who.captain.db.rpc('delete_unplayed_player', { p_player: '00000000-0000-4000-8000-000000000000' });
    expect(remove.error).not.toBeNull();
  });
});

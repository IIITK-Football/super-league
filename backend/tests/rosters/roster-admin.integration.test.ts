// Group: rosters. Dictator player and roster management (/api/admin/players, /api/admin/roster) and the captain
// portrait upload (/api/admin/freshers/player-image), run for real against THIS repository's local Supabase stack
// with each account's token, as the dashboard and team builder send it. Allowed for a dictator; refused for a
// captain, legacy admin, editor, normal user and anon, with nothing written. Every allowed write is checked in the
// database.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clients, localKeys, uniqueEmail } from '../auth/local-supabase';

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));

const tag = `roster${Date.now().toString(36)}`;
let admin: SupabaseClient;
let anon: () => SupabaseClient;
const users: string[] = [];
const made = { seasons: [] as string[], teams: [] as string[], entries: [] as string[], players: [] as string[], matches: [] as string[], regs: [] as string[] };
const tokens: Record<string, { id: string; token: string }> = {};

async function tokenFor(role: string) {
  const email = uniqueEmail(`roster-${role}`);
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  users.push(data.user.id);
  await admin.from('user_roles').update({ role }).eq('user_id', data.user.id);
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const { data: v, error: vErr } = await anon().auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'magiclink' });
  if (vErr) throw vErr;
  return { id: data.user.id, token: v.session!.access_token };
}

const must = <T extends { error: unknown }>(r: T): T => {
  if (r.error) throw new Error(`setup failed: ${JSON.stringify(r.error)}`);
  return r;
};

type Handler = (r: Request) => Promise<Response>;
async function call(path: string, method: string, who: string | null, body?: unknown, query = '') {
  const mod = await import(`../../app/api/${path}/route`);
  const headers: Record<string, string> = {};
  if (who) headers.Authorization = `Bearer ${tokens[who].token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res: Response = await (mod[method] as Handler)(new Request(`http://localhost/api/${path}${query}`, { method, headers, body: payload }));
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  const keys = localKeys();
  Object.assign(process.env, { SUPABASE_URL: keys.url, SUPABASE_PUBLISHABLE_KEY: keys.publishable, SUPABASE_SECRET_KEY: keys.secret });
  const c = clients(keys);
  admin = c.admin;
  anon = c.anon;
  for (const role of ['dictator', 'captain', 'admin', 'editor', 'default']) tokens[role] = await tokenFor(role);

  const wsl = must(await admin.from('divisions').select('id').eq('slug', 'wsl').single()).data!;
  made.seasons = must(await admin.from('seasons').insert([
    { division_id: wsl.id, slug: `${tag}-a`, name: `${tag} A` }, { division_id: wsl.id, slug: `${tag}-b`, name: `${tag} B` },
  ]).select('id')).data!.map((s) => s.id);
  made.teams = must(await admin.from('teams').insert([{ name: `${tag} One`, short_name: 'ONE' }, { name: `${tag} Two`, short_name: 'TWO' }]).select('id')).data!.map((t) => t.id);
  made.entries = must(await admin.from('team_entries').insert([
    { team_id: made.teams[0], season_id: made.seasons[0] }, { team_id: made.teams[1], season_id: made.seasons[0] },
    { team_id: made.teams[0], season_id: made.seasons[1] },
  ]).select('id')).data!.map((e) => e.id);
  // The captain holds team One's registration for season A only.
  made.regs = must(await admin.from('team_registrations').insert({ captain_id: tokens.captain.id, team_name: `${tag} One`, season_id: made.seasons[0], team_id: made.teams[0] }).select('id')).data!.map((r) => r.id);
}, 90000);

afterAll(async () => {
  if (!admin) return;
  for (const id of made.matches) await admin.from('matches').delete().eq('id', id);
  await admin.from('roster_memberships').delete().in('season_id', made.seasons);
  const { data: left } = await admin.from('players').select('id').ilike('first_name', `${tag}%`);
  await admin.from('players').delete().in('id', (left ?? []).map((p) => p.id));
  await admin.from('team_registrations').delete().in('id', made.regs);
  await admin.from('team_entries').delete().in('season_id', made.seasons);
  await admin.from('teams').delete().in('id', made.teams);
  await admin.from('seasons').delete().in('id', made.seasons);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 60000);

describe('a dictator manages players and season rosters', () => {
  let player = '';
  let place = '';

  it('creates a player on a season roster in one step, with a private email', async () => {
    const res = await call('admin/players', 'POST', 'dictator', {
      team_entry_id: made.entries[0], first_name: `${tag}Ada`, last_name: 'Striker', jersey_number: 9, position: 'ST', overall_rating: 72,
      attributes: { pace: 80 }, email: 'Ada.Striker@IIITKottayam.ac.in',
    });
    expect(res.status).toBe(201);
    player = res.body.data.id;
    const { data } = await admin.from('players').select('first_name, last_name, overall_rating, attributes, roster_memberships(id, team_entry_id, jersey_number, position), player_private_details(email)').eq('id', player).single();
    expect(data).toMatchObject({ first_name: `${tag}Ada`, last_name: 'Striker', overall_rating: 72, attributes: { pace: 80 } });
    expect((data as any).roster_memberships).toEqual([expect.objectContaining({ team_entry_id: made.entries[0], jersey_number: 9, position: 'ST' })]);
    expect((data as any).player_private_details).toMatchObject({ email: 'ada.striker@iiitkottayam.ac.in' });
    place = (data as any).roster_memberships[0].id;
  });

  it('refuses a jersey already taken on the team, and a second team in the same season', async () => {
    const clash = await call('admin/players', 'POST', 'dictator', { team_entry_id: made.entries[0], first_name: `${tag}Ben`, last_name: 'Clash', jersey_number: 9 });
    expect(clash.status).toBe(409);
    expect(clash.body.message).toMatch(/jersey number is already taken/);
    const twice = await call('admin/roster', 'POST', 'dictator', { player_id: player, team_entry_id: made.entries[1] });
    expect(twice.status).toBe(409);
    expect(twice.body.message).toMatch(/already on a team this season/);
  });

  it('adds the same player to another season\'s roster: one identity, two seasons', async () => {
    const res = await call('admin/roster', 'POST', 'dictator', { player_id: player, team_entry_id: made.entries[2], jersey_number: 10, position: 'CF' });
    expect(res.status).toBe(201);
    const { count } = await admin.from('roster_memberships').select('id', { count: 'exact', head: true }).eq('player_id', player);
    expect(count).toBe(2);
    const { count: identities } = await admin.from('players').select('id', { count: 'exact', head: true }).eq('first_name', `${tag}Ada`);
    expect(identities).toBe(1);
  });

  it('moves a player within a season, and refuses a move to another season', async () => {
    const moved = await call('admin/roster', 'PATCH', 'dictator', { membership_id: place, team_entry_id: made.entries[1], jersey_number: 11 });
    expect(moved.status).toBe(200);
    expect((await admin.from('roster_memberships').select('team_entry_id, jersey_number').eq('id', place).single()).data)
      .toEqual({ team_entry_id: made.entries[1], jersey_number: 11 });
    const across = await call('admin/roster', 'PATCH', 'dictator', { membership_id: place, team_entry_id: made.entries[2] });
    expect(across.status).toBe(400);
    expect(across.body.message).toMatch(/same season/);
  });

  it('edits the card and private email, and clears the email', async () => {
    const res = await call('admin/players', 'PUT', 'dictator', { id: player, last_name: 'Finisher', overall_rating: 80, email: 'ada@iiitkottayam.ac.in' });
    expect(res.status).toBe(200);
    expect((await admin.from('players').select('last_name, overall_rating').eq('id', player).single()).data).toEqual({ last_name: 'Finisher', overall_rating: 80 });
    expect((await admin.from('player_private_details').select('email').eq('player_id', player).single()).data!.email).toBe('ada@iiitkottayam.ac.in');
    expect((await call('admin/players', 'PUT', 'dictator', { id: player, email: null })).status).toBe(200);
    expect((await admin.from('player_private_details').select('email').eq('player_id', player)).data).toEqual([]);
    expect((await call('admin/players', 'PUT', 'dictator', { id: player, overall_rating: 120 })).status).toBe(400);
  });

  it('keeps history: a roster place with goals and a player with roster places cannot be removed', async () => {
    const { data: match } = must(await admin.from('matches').insert({ home_team_id: made.teams[1], away_team_id: made.teams[0], season_id: made.seasons[0], status: 'completed', home_score: 1, away_score: 0 }).select('id').single());
    made.matches.push(match!.id);
    must(await admin.from('goals').insert({ match_id: match!.id, team_id: made.teams[1], player_id: player, minute: 5 }));
    const keep = await call('admin/roster', 'DELETE', 'dictator', undefined, `?membership_id=${place}`);
    expect(keep.status).toBe(409);
    const del = await call('admin/players', 'DELETE', 'dictator', undefined, `?id=${player}`);
    expect(del.status).toBe(409);
    expect((await admin.from('players').select('id').eq('id', player)).data).toHaveLength(1);
  });

  it('removes a roster place without history, then deletes a player who never played', async () => {
    const created = await call('admin/players', 'POST', 'dictator', { team_entry_id: made.entries[2], first_name: `${tag}Cal`, last_name: 'Bench' });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    const { data: placeRow } = await admin.from('roster_memberships').select('id').eq('player_id', id).single();
    expect((await call('admin/players', 'DELETE', 'dictator', undefined, `?id=${id}`)).status).toBe(409);
    expect((await call('admin/roster', 'DELETE', 'dictator', undefined, `?membership_id=${placeRow!.id}`)).status).toBe(200);
    expect((await call('admin/players', 'DELETE', 'dictator', undefined, `?id=${id}`)).status).toBe(200);
    expect((await admin.from('players').select('id').eq('id', id)).data).toEqual([]);
  });

  it('the public roster and player page never show the private email', async () => {
    const res = await call('players', 'GET', null, undefined, `?division=wsl&season=${tag}-a`);
    expect(JSON.stringify(res.body)).not.toMatch(/@iiitkottayam/);
  });
});

describe.each(['captain', 'admin', 'editor', 'default'])('a %s account is refused', (who) => {
  it('cannot create, edit, move or remove players, and nothing is written', async () => {
    const before = (await admin.from('players').select('id', { count: 'exact', head: true }).ilike('first_name', `${tag}%`)).count;
    const create = await call('admin/players', 'POST', who, { team_entry_id: made.entries[0], first_name: `${tag}Intruder`, last_name: who });
    expect(create.status).toBe(403);
    const { data: any } = await admin.from('roster_memberships').select('id').eq('season_id', made.seasons[0]).limit(1);
    const someone = (await admin.from('roster_memberships').select('player_id').eq('season_id', made.seasons[0]).limit(1)).data![0].player_id;
    expect((await call('admin/players', 'PUT', who, { id: someone, first_name: `${tag}Renamed` })).status).toBe(403);
    expect((await call('admin/players', 'DELETE', who, undefined, `?id=${someone}`)).status).toBe(403);
    expect((await call('admin/roster', 'POST', who, { player_id: someone, team_entry_id: made.entries[2] })).status).toBe(403);
    expect((await call('admin/roster', 'PATCH', who, { membership_id: any![0].id, jersey_number: 99 })).status).toBe(403);
    expect((await call('admin/roster', 'DELETE', who, undefined, `?membership_id=${any![0].id}`)).status).toBe(403);
    const after = (await admin.from('players').select('id', { count: 'exact', head: true }).ilike('first_name', `${tag}%`)).count;
    expect(after).toBe(before);
    expect((await admin.from('players').select('first_name').eq('id', someone).single()).data!.first_name).not.toBe(`${tag}Renamed`);
  });
});

describe('without signing in', () => {
  it('every write is refused with 401', async () => {
    expect((await call('admin/players', 'POST', null, { team_entry_id: made.entries[0], first_name: 'x' })).status).toBe(401);
    expect((await call('admin/roster', 'DELETE', null, undefined, `?membership_id=${made.entries[0]}`)).status).toBe(401);
    const form = new FormData();
    form.set('membership_id', made.entries[0]);
    expect((await call('admin/freshers/player-image', 'POST', null, form)).status).toBe(401);
  });
});

describe('the captain portrait upload', () => {
  const upload = (who: string, membershipId: string) => {
    const form = new FormData();
    form.set('membership_id', membershipId);
    return call('admin/freshers/player-image', 'POST', who, form);
  };

  it('a captain may upload only for a player on their team in their season; a dictator for anyone', async () => {
    const ownPlace = must(await admin.from('roster_memberships').select('id').eq('team_entry_id', made.entries[1]).limit(1)).data!;
    const created = await call('admin/players', 'POST', 'dictator', { team_entry_id: made.entries[0], first_name: `${tag}Dee`, last_name: 'Keeper', jersey_number: 1 });
    const own = must(await admin.from('roster_memberships').select('id').eq('player_id', created.body.data.id).single()).data!.id;
    // Allowed past authorization; there is no image, so the request stops at validation (no upload is attempted).
    expect((await upload('captain', own)).status).toBe(400);
    expect((await upload('dictator', own)).status).toBe(400);
    expect((await upload('captain', ownPlace[0].id)).status).toBe(403); // team Two
    expect((await upload('admin', own)).status).toBe(403);
    expect((await upload('editor', own)).status).toBe(403);
    expect((await upload('default', own)).status).toBe(403);
  });
});

describe('the team registration route', () => {
  it('no longer writes players: a request with members is refused', async () => {
    const res = await call('admin/team-registrations', 'POST', 'dictator', { team_name: `${tag} Reg`, captain_id: tokens.default.id, division: 'wsl', members: [{ name: 'Old Way' }] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/season roster/);
  });
});

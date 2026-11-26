// Group: rosters. Dictator player and roster management through the real local Data API, as the Teams & Rosters
// dashboard sends it: each account is signed in with its own token, so row level security, create_player_for_account
// and the history triggers decide. Allowed for a dictator; refused for a captain, editor, normal user
// and anon, with nothing written. Also the captain portrait upload route and the registration route. Runs against
// THIS repository's local Supabase stack (127.0.0.1:54321).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clients, localKeys, uniqueEmail } from '../auth/local-supabase';
import { insertLocal } from '../local-fixtures';

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));

const tag = `roster${Date.now().toString(36)}`;
let admin: SupabaseClient;
let anonClient: SupabaseClient;
const users: string[] = [];
const made = { division: '', seasons: [] as string[], teams: [] as string[], entries: [] as string[], matches: [] as string[], regs: [] as string[] };
const as: Record<string, { id: string; token: string; db: SupabaseClient }> = {};

async function signIn(role: string, c: ReturnType<typeof clients>) {
  const email = uniqueEmail(`roster-${role}`);
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  users.push(data.user.id);
  if (role !== 'default') await admin.from('user_roles').upsert({ user_id: data.user.id, role: role }, { onConflict: 'user_id,role', ignoreDuplicates: true });
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const db = c.anon();
  const { data: v, error: vErr } = await db.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'magiclink' });
  if (vErr) throw vErr;
  return { id: data.user.id, token: v.session!.access_token, db };
}

const must = <T extends { error: unknown }>(r: T): T => {
  if (r.error) throw new Error(`setup failed: ${JSON.stringify(r.error)}`);
  return r;
};

async function route(path: string, who: string | null, body: FormData | object) {
  const mod = await import(`../../app/api/${path}/route`);
  const headers: Record<string, string> = who ? { Authorization: `Bearer ${as[who].token}` } : {};
  let payload: BodyInit;
  if (body instanceof FormData) payload = body;
  else {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res: Response = await mod.POST(new Request(`http://localhost/api/${path}`, { method: 'POST', headers, body: payload }));
  return { status: res.status, body: await res.json() };
}

// A fresh verified account for each new player (every new player needs one).
async function verifiedAccount(label: string) {
  const { data, error } = await admin.auth.admin.createUser({ email: uniqueEmail(`roster-${label}`), email_confirm: true });
  if (error) throw error;
  users.push(data.user.id);
  return { id: data.user.id, email: data.user.email! };
}
const create = async (who: string, entry: string, first: string, extra: Record<string, unknown> = {}) => {
  const account = await verifiedAccount(first.toLowerCase().slice(-12));
  return as[who].db.rpc('create_player_for_account', { p_user: account.id, p_team_entry_id: entry, p_first_name: first, p_last_name: 'Test', ...extra });
};

beforeAll(async () => {
  const keys = localKeys();
  Object.assign(process.env, { SUPABASE_URL: keys.url, SUPABASE_PUBLISHABLE_KEY: keys.publishable, SUPABASE_SECRET_KEY: keys.secret });
  const c = clients(keys);
  admin = c.admin;
  anonClient = c.anon();
  for (const role of ['dictator', 'captain', 'editor', 'default']) as[role] = await signIn(role, c);

  // The test's own division: season A is its current season (captains edit only current-season rosters).
  made.division = must(await admin.from('divisions').insert({ visibility: 'public', slug: tag, name: `${tag} Division` }).select('id').single()).data!.id;
  made.seasons = must(await admin.from('seasons').insert([
    { visibility: 'public', division_id: made.division, slug: `${tag}-a`, name: `${tag} A`, is_current: true },
    { visibility: 'public', division_id: made.division, slug: `${tag}-b`, name: `${tag} B`, is_current: false },
  ]).select('id')).data!.map((s) => s.id);
  made.teams = must(await admin.from('teams').insert([{ name: `${tag} One`, short_name: 'ONE' }, { name: `${tag} Two`, short_name: 'TWO' }]).select('id')).data!.map((t) => t.id);
  made.entries = must(await admin.from('team_entries').insert([
    { team_id: made.teams[0], season_id: made.seasons[0] }, { team_id: made.teams[1], season_id: made.seasons[0] },
    { team_id: made.teams[0], season_id: made.seasons[1] },
  ]).select('id')).data!.map((e) => e.id);
  // A fixed player on each team of season A, used by the refusal and portrait tests.
  // Legacy players without an account (the API no longer creates these; written as the seed writes them).
  const fixed = insertLocal<{ id: string }>('players', [{ first_name: `${tag}FixedOne`, last_name: 'Keeper' }, { first_name: `${tag}FixedTwo`, last_name: 'Keeper' }]);
  insertLocal('roster_memberships', [
    { player_id: fixed[0].id, team_entry_id: made.entries[0], season_id: made.seasons[0], jersey_number: 1 },
    { player_id: fixed[1].id, team_entry_id: made.entries[1], season_id: made.seasons[0], jersey_number: 1 },
  ]);
  // The captain is assigned to team One's entry in season A only.
  must(await admin.from('captain_assignments').insert({ team_entry_id: made.entries[0], user_id: as.captain.id }));
}, 90000);

afterAll(async () => {
  if (!admin) return;
  for (const id of made.matches) await admin.from('matches').delete().eq('id', id);
  await admin.from('roster_memberships').delete().in('season_id', made.seasons);
  const { data: left } = await admin.from('players').select('id').ilike('first_name', `${tag}%`);
  await admin.from('players').delete().in('id', (left ?? []).map((p) => p.id));
  await admin.from('captain_assignments').delete().in('team_entry_id', made.entries);
  await admin.from('team_entries').delete().in('season_id', made.seasons);
  await admin.from('teams').delete().in('id', made.teams);
  await admin.from('seasons').delete().in('id', made.seasons);
  if (made.division) await admin.from('divisions').delete().eq('id', made.division);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 60000);

describe('a dictator manages players and season rosters', () => {
  let player = '';
  let place = '';

  let adaEmail = '';
  it('creates a player for a verified account on a season roster in one step; the email is the account\'s', async () => {
    const account = await verifiedAccount('ada');
    adaEmail = account.email;
    const { data, error } = await as.dictator.db.rpc('create_player_for_account', {
      p_user: account.id, p_team_entry_id: made.entries[0], p_first_name: `${tag}Ada`,
      p_last_name: 'Striker', p_jersey_number: 9, p_position: 'ST', p_overall_rating: 72, p_attributes: { stats: { Pace: { total: 80 } } },
    });
    expect(error).toBeNull();
    player = data as string;
    const row = (await admin.from('players').select('first_name, overall_rating, attributes, user_id, roster_memberships(id, team_entry_id, jersey_number, position)').eq('id', player).single()).data as any;
    expect(row).toMatchObject({ first_name: `${tag}Ada`, overall_rating: 72, attributes: { stats: { Pace: { total: 80 } } }, user_id: account.id });
    expect(row.roster_memberships).toEqual([expect.objectContaining({ team_entry_id: made.entries[0], jersey_number: 9, position: 'ST' })]);
    const status = (await as.dictator.db.rpc('player_link_status', { p_player_ids: [player] })).data;
    expect(status).toEqual([expect.objectContaining({ linked: true, email: account.email })]);
    place = row.roster_memberships[0].id;
  });

  it('refuses a jersey already taken on the team, and a second team in the same season', async () => {
    const clash = await create('dictator', made.entries[0], `${tag}Ben`, { p_jersey_number: 9 });
    expect(clash.error?.code).toBe('23505');
    const twice = await as.dictator.db.rpc('add_player_to_roster', { p_player: player, p_team_entry_id: made.entries[1] });
    expect(twice.error?.code).toBe('23505');
    expect((await admin.from('players').select('id').eq('first_name', `${tag}Ben`)).data).toEqual([]);
  });

  it('adds the same player to another season\'s roster: one identity, two seasons', async () => {
    const res = await as.dictator.db.rpc('add_player_to_roster', { p_player: player, p_team_entry_id: made.entries[2], p_jersey_number: 10, p_position: 'CF' });
    expect(res.error).toBeNull();
    expect((await admin.from('roster_memberships').select('id', { count: 'exact', head: true }).eq('player_id', player)).count).toBe(2);
    expect((await admin.from('players').select('id', { count: 'exact', head: true }).eq('first_name', `${tag}Ada`)).count).toBe(1);
  });

  it('moves a player within a season; a roster place cannot point at another season\'s team', async () => {
    const moved = await as.dictator.db.from('roster_memberships').update({ team_entry_id: made.entries[1], jersey_number: 11 }).eq('id', place).select('id');
    expect(moved.data).toHaveLength(1);
    const across = await as.dictator.db.from('roster_memberships').update({ team_entry_id: made.entries[2] }).eq('id', place).select('id');
    expect(across.error?.code).toBe('23503');
  });

  it('edits the card; there is no separate contact email to set', async () => {
    expect((await as.dictator.db.from('players').update({ last_name: 'Finisher', overall_rating: 80 }).eq('id', player).select('id')).data).toHaveLength(1);
    expect((await as.dictator.db.from('player_private_details' as any).select('email')).error).toBeTruthy();
    const status = (await as.dictator.db.rpc('player_link_status', { p_player_ids: [player] })).data;
    expect(status[0].email).toBe(adaEmail);
  });

  it('refuses a new roster place for a legacy player without an account', async () => {
    const legacy = (await admin.from('roster_memberships').select('player_id').eq('team_entry_id', made.entries[0]).neq('player_id', player).limit(1)).data![0].player_id;
    const res = await as.dictator.db.rpc('add_player_to_roster', { p_player: legacy, p_team_entry_id: made.entries[2] });
    expect(res.error?.code).toBe('23514');
    expect(res.error?.message).toMatch(/not linked to an account/);
    expect((await as.dictator.db.from('roster_memberships').insert({ player_id: legacy, team_entry_id: made.entries[2], season_id: made.seasons[1] })).error?.code).toBe('23514');
  });

  it('keeps history: a roster place with goals, and a player who scored or assisted, cannot be removed', async () => {
    const helper = (await create('dictator', made.entries[1], `${tag}Helper`)).data as string;
    const { data: match } = must(await admin.from('matches').insert({ home_team_id: made.teams[1], away_team_id: made.teams[0], season_id: made.seasons[0], status: 'completed' }).select('id').single());
    made.matches.push(match!.id);
    must(await admin.from('match_events').insert({ match_id: match!.id, team_id: made.teams[1], kind: 'goal', player_id: player, assist_player_id: helper, minute: 5 }));
    const keep = await as.dictator.db.from('roster_memberships').delete().eq('id', place);
    expect(keep.error?.message).toMatch(/goals or assists this season/);
    const helperPlace = (await admin.from('roster_memberships').select('id').eq('player_id', helper).single()).data!.id;
    expect((await as.dictator.db.from('roster_memberships').delete().eq('id', helperPlace)).error?.message).toMatch(/goals or assists this season/);
    expect((await as.dictator.db.from('players').delete().eq('id', player)).error?.code).toBe('23503');
    // Even the server key cannot erase it.
    expect((await admin.from('roster_memberships').delete().eq('id', place)).error?.message).toMatch(/goals or assists this season/);
    expect((await admin.from('roster_memberships').select('id').eq('id', place)).data).toHaveLength(1);
  });

  it('removes a roster place without history, then deletes a player who never played', async () => {
    const id = (await create('dictator', made.entries[2], `${tag}Cal`)).data as string;
    expect((await as.dictator.db.from('players').delete().eq('id', id)).error?.code).toBe('23503'); // still rostered
    expect((await as.dictator.db.from('roster_memberships').delete().eq('player_id', id).select('id')).data).toHaveLength(1);
    expect((await as.dictator.db.from('players').delete().eq('id', id).select('id')).data).toHaveLength(1);
  });

  it('visitors read cards and rosters but never private details', async () => {
    expect((await anonClient.from('players').select('id').eq('id', player)).data).toHaveLength(1);
    expect((await anonClient.from('player_link_keys' as any).select('email')).error).toBeTruthy();
  });
});

describe.each(['captain', 'editor', 'default'])('a %s account', (who) => {
  it('cannot create, rename, move, add or remove players, and nothing is written', async () => {
    const before = (await admin.from('players').select('id', { count: 'exact', head: true }).ilike('first_name', `${tag}%`)).count;
    const created = await create(who, made.entries[0], `${tag}Intruder`);
    expect(created.error?.code).toBe('42501');
    const someone = (await admin.from('roster_memberships').select('id, player_id').eq('team_entry_id', made.entries[0]).limit(1)).data![0];
    expect((await as[who].db.from('players').update({ first_name: `${tag}Renamed` }).eq('id', someone.player_id).select('id')).data).toEqual([]);
    expect((await as[who].db.from('roster_memberships').update({ jersey_number: 99 }).eq('id', someone.id).select('id')).data).toEqual([]);
    expect((await as[who].db.from('roster_memberships').delete().eq('id', someone.id).select('id')).data).toEqual([]);
    expect((await as[who].db.from('roster_memberships').insert({ player_id: someone.player_id, team_entry_id: made.entries[2], season_id: made.seasons[1] })).error).toBeTruthy();
    expect((await as[who].db.rpc('add_player_to_roster', { p_player: someone.player_id, p_team_entry_id: made.entries[2] })).error?.code).toBe('42501');
    expect((await as[who].db.from('players').insert({ first_name: `${tag}Fake`, last_name: who })).error?.code).toBe('42501');
    expect((await as[who].db.from('player_link_keys' as any).select('player_id')).error).toBeTruthy();
    expect((await admin.from('players').select('id', { count: 'exact', head: true }).ilike('first_name', `${tag}%`)).count).toBe(before);
    expect((await admin.from('players').select('first_name').eq('id', someone.player_id).single()).data!.first_name).not.toBe(`${tag}Renamed`);
  });
});

describe('the captain portrait upload route', () => {
  const upload = (who: string | null, membershipId: string) => {
    const form = new FormData();
    form.set('membership_id', membershipId);
    return route('admin/freshers/player-image', who, form);
  };

  it('a captain may upload only for a player on their team in their season; a dictator for anyone', async () => {
    const own = (await admin.from('roster_memberships').select('id').eq('team_entry_id', made.entries[0]).limit(1)).data![0].id;
    const other = (await admin.from('roster_memberships').select('id').eq('team_entry_id', made.entries[1]).limit(1)).data![0].id;
    // Past authorization the request stops at validation: no image was sent, so nothing is uploaded.
    expect((await upload('captain', own)).status).toBe(400);
    expect((await upload('dictator', own)).status).toBe(400);
    expect((await upload('captain', other)).status).toBe(403);
    for (const who of ['editor', 'default']) expect((await upload(who, own)).status).toBe(403);
    expect((await upload(null, own)).status).toBe(401);
  });
});

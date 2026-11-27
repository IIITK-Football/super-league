// Group: player-accounts. Linking players to verified accounts through the real local Data API, each account signed in
// with its own token: the dictator's matching preview (ready, duplicate, waiting for verification, conflict, no account)
// and apply (only still-ready previewed pairs, idempotent, never by name), manual links found by Auth email
// (verified accounts only, one player per account and one account per player), account-first player creation (an
// account that already has a player, or that an unlinked player is waiting for, gets no second identity), linked-only
// roster places, and unlinking (only the link changes; the player then has no email and no key). A captain, an
// editor, a normal user and the server key are refused on every path. Legacy unlinked players and their match keys
// are written as the seed writes them (local only). Runs against THIS repository's local Supabase (127.0.0.1:54321).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clients, localKeys, uniqueEmail } from '../auth/local-supabase';
import { insertLocal } from '../local-fixtures';


const tag = `acct${Date.now().toString(36)}`;
let admin: SupabaseClient;
const users: string[] = [];
const as: Record<string, { id: string; email: string; db: SupabaseClient }> = {};
const made = { division: '', season: '', team: '', entry: '', legacy: [] as string[], created: [] as string[] };

async function account(label: string, verified = true) {
  const { data, error } = await admin.auth.admin.createUser({ email: uniqueEmail(`${tag}-${label}`), email_confirm: verified });
  if (error) throw error;
  users.push(data.user.id);
  return { id: data.user.id, email: data.user.email! };
}
async function signIn(label: string, role: string, c: ReturnType<typeof clients>) {
  const { id, email } = await account(label);
  if (role !== 'default') await admin.from('user_roles').upsert({ user_id: id, role: role }, { onConflict: 'user_id,role', ignoreDuplicates: true });
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const db = c.anon();
  const { error } = await db.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'magiclink' });
  if (error) throw error;
  return { id, email, db };
}
const must = <T extends { error: unknown }>(r: T): T => {
  if (r.error) throw new Error(`setup failed: ${JSON.stringify(r.error)}`);
  return r;
};
const linkOf = async (player: string) => (await admin.from('players').select('user_id').eq('id', player).single()).data!.user_id as string | null;
const keyOf = async (player: string) => (await as.dictator.db.rpc('player_link_status', { p_player_ids: [player] })).data[0].has_key as boolean;
const ours = async () => ((await as.dictator.db.rpc('account_link_matches')).data as { player_id: string; status: string; user_id: string | null }[])
  .filter((m) => made.legacy.includes(m.player_id));

let ready: { id: string; email: string };
let dup: { id: string; email: string };

beforeAll(async () => {
  const keys = localKeys();
  Object.assign(process.env, { SUPABASE_URL: keys.url, SUPABASE_PUBLISHABLE_KEY: keys.publishable, SUPABASE_SECRET_KEY: keys.secret });
  const c = clients(keys);
  admin = c.admin;
  for (const [label, role] of [['dictator', 'dictator'], ['captain', 'captain'], ['editor', 'editor'], ['fan', 'default']]) as[label] = await signIn(label, role, c);
  made.division = must(await admin.from('divisions').insert({ visibility: 'public', slug: tag, name: `${tag} Division` }).select('id').single()).data!.id;
  made.season = must(await admin.from('seasons').insert({ visibility: 'public', division_id: made.division, slug: `${tag}-a`, name: `${tag} A`, is_current: true }).select('id').single()).data!.id;
  made.team = must(await admin.from('teams').insert({ name: `${tag} One`, short_name: 'ONE' }).select('id').single()).data!.id;
  made.entry = must(await admin.from('team_entries').insert({ team_id: made.team, season_id: made.season }).select('id').single()).data!.id;
  // Accounts first, then the legacy keys (as for people who signed up before the conversion): nothing links on its own.
  ready = await account('ready');
  dup = await account('dup');
  const waiting = await account('waiting', false);
  made.legacy = insertLocal<{ id: string }>('players', ['Ready', 'DupOne', 'DupTwo', 'Waiting', 'Nobody', 'Conflict'].map((n) => ({ first_name: `${tag}${n}`, last_name: 'Legacy' }))).map((p) => p.id);
  insertLocal('roster_memberships', made.legacy.map((player_id, i) => ({ player_id, team_entry_id: made.entry, season_id: made.season, jersey_number: i + 1 })));
  insertLocal('player_link_keys', [
    { player_id: made.legacy[0], email: ready.email.toLowerCase() },
    { player_id: made.legacy[1], email: dup.email.toLowerCase() },
    { player_id: made.legacy[2], email: dup.email.toLowerCase() },
    { player_id: made.legacy[3], email: waiting.email.toLowerCase() },
    { player_id: made.legacy[4], email: `${tag}-nobody@iiitkottayam.ac.in` },
    { player_id: made.legacy[5], email: as.fan.email.toLowerCase() },
  ]);
}, 120000);

afterAll(async () => {
  if (!admin) return;
  const players = [...made.legacy, ...made.created];
  await admin.from('roster_memberships').delete().eq('season_id', made.season);
  if (players.length) await admin.from('players').delete().in('id', players);
  await admin.from('team_entries').delete().eq('id', made.entry);
  await admin.from('teams').delete().eq('id', made.team);
  await admin.from('seasons').delete().eq('id', made.season);
  if (made.division) await admin.from('divisions').delete().eq('id', made.division);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 60000);

describe('the matching preview and apply', () => {
  it('a conflict needs the account linked elsewhere: link the fan first by hand', async () => {
    const fanPlayer = await as.dictator.db.rpc('create_player_for_account', { p_user: as.fan.id, p_team_entry_id: made.entry, p_first_name: `${tag}Fan`, p_last_name: 'Own' });
    // The fan's email is legacy Conflict's key, so creating a second identity is refused and points at that player.
    expect(fanPlayer.error?.code).toBe('23505');
    expect(fanPlayer.error?.details).toBe(made.legacy[5]);
    const other = insertLocal<{ id: string }>('players', [{ first_name: `${tag}FanCard`, last_name: 'Own' }])[0].id;
    made.created.push(other);
    must(await as.dictator.db.rpc('link_player_account', { p_player: other, p_user: as.fan.id }));
  });

  it('reports each case, matching verified emails only and never by name', async () => {
    const byPlayer = Object.fromEntries((await ours()).map((m) => [m.player_id, m]));
    expect(made.legacy.map((p) => byPlayer[p]?.status)).toEqual(['ready', 'duplicate', 'duplicate', 'waiting_verification', 'no_account', 'conflict']);
    expect(byPlayer[made.legacy[0]].user_id).toBe(ready.id);
    expect((await as.captain.db.rpc('account_link_matches')).error?.code).toBe('42501');
    expect((await as.fan.db.rpc('account_link_matches')).error?.code).toBe('42501');
  });

  it('applies only the previewed pairs that are still ready, once', async () => {
    const pairs = (await ours()).filter((m) => m.status === 'ready').map(({ player_id, user_id }) => ({ player_id, user_id }));
    expect((await as.captain.db.rpc('apply_account_link_matches', { p_expected: pairs })).error?.code).toBe('42501');
    const first = must(await as.dictator.db.rpc('apply_account_link_matches', {
      p_expected: [...pairs, { player_id: made.legacy[1], user_id: dup.id }, { player_id: made.legacy[4], user_id: ready.id }],
    })).data;
    expect(first.linked).toBe(1);
    expect(first.skipped.map((s: { status: string }) => s.status).sort()).toEqual(['changed', 'duplicate']);
    expect(await linkOf(made.legacy[0])).toBe(ready.id);
    expect(await keyOf(made.legacy[0])).toBe(false);
    expect(await linkOf(made.legacy[1])).toBeNull();
    const again = must(await as.dictator.db.rpc('apply_account_link_matches', { p_expected: pairs })).data;
    expect(again.linked).toBe(0);
  });
});

describe('manual links', () => {
  it('finds verified accounts by Auth email only, with the player each is linked to', async () => {
    const found = (await as.dictator.db.rpc('verified_accounts_for_linking', { p_query: `${tag}-ready` })).data;
    expect(found).toEqual([expect.objectContaining({ user_id: ready.id, linked_player_id: made.legacy[0] })]);
    expect((await as.dictator.db.rpc('verified_accounts_for_linking', { p_query: `${tag}-waiting` })).data).toEqual([]);
    expect((await as.dictator.db.rpc('verified_accounts_for_linking', { p_query: `${tag}Ready` })).data).toEqual([]); // a player name finds nothing
    expect((await as.captain.db.rpc('verified_accounts_for_linking', { p_query: `${tag}-ready` })).data).toEqual([]);
  });

  it('resolves a duplicate by hand; one player per account and one account per player', async () => {
    const unverified = await account('unverified', false);
    expect((await as.dictator.db.rpc('link_player_account', { p_player: made.legacy[1], p_user: unverified.id })).error?.code).toBe('23514');
    for (const who of ['captain', 'editor', 'fan']) {
      expect((await as[who].db.rpc('link_player_account', { p_player: made.legacy[1], p_user: dup.id })).error?.code, who).toBe('42501');
    }
    must(await as.dictator.db.rpc('link_player_account', { p_player: made.legacy[1], p_user: dup.id }));
    expect(await linkOf(made.legacy[1])).toBe(dup.id);
    expect(await keyOf(made.legacy[1])).toBe(false);
    expect((await as.dictator.db.rpc('link_player_account', { p_player: made.legacy[2], p_user: dup.id })).error?.code).toBe('23505');
    const another = await account('another');
    expect((await as.dictator.db.rpc('link_player_account', { p_player: made.legacy[1], p_user: another.id })).error?.code).toBe('23505');
    expect(await linkOf(made.legacy[1])).toBe(dup.id);
  });

  it('nobody claims or writes the link directly, not even with the server key', async () => {
    expect((await as.fan.db.from('players').update({ user_id: as.fan.id } as any).eq('id', made.legacy[2]).select('id')).error).toBeTruthy();
    expect((await admin.from('players').update({ user_id: as.dictator.id } as any).eq('id', made.legacy[2])).error?.code).toBe('42501');
    expect(await linkOf(made.legacy[2])).toBeNull();
  });
});

describe('account-first players and linked-only rosters', () => {
  it('creates, links and rosters a new player for a verified account in one step', async () => {
    const fresh = await account('fresh');
    const r = must(await as.dictator.db.rpc('create_player_for_account', {
      p_user: fresh.id, p_team_entry_id: made.entry, p_first_name: `${tag}Fresh`, p_last_name: 'Face', p_jersey_number: 40, p_position: 'ST', p_overall_rating: 66,
    }));
    made.created.push(r.data);
    const row = (await admin.from('players').select('user_id, overall_rating, roster_memberships(jersey_number, position)').eq('id', r.data).single()).data as any;
    expect(row).toEqual({ user_id: fresh.id, overall_rating: 66, roster_memberships: [{ jersey_number: 40, position: 'ST' }] });
  });

  it('offers the existing identity instead of creating a duplicate', async () => {
    const twice = await as.dictator.db.rpc('create_player_for_account', { p_user: ready.id, p_team_entry_id: made.entry, p_first_name: `${tag}Again`, p_last_name: 'Ready' });
    expect(twice.error?.code).toBe('23505');
    expect(twice.error?.details).toBe(made.legacy[0]);
    expect((await admin.from('players').select('id').eq('first_name', `${tag}Again`)).data).toEqual([]);
  });

  it('refuses unverified accounts, other roles, the server key and direct inserts', async () => {
    const unverified = await account('noverify', false);
    expect((await as.dictator.db.rpc('create_player_for_account', { p_user: unverified.id, p_team_entry_id: made.entry, p_first_name: `${tag}X`, p_last_name: 'Y' })).error?.code).toBe('23514');
    const spare = await account('spare');
    for (const who of ['captain', 'editor', 'fan']) {
      expect((await as[who].db.rpc('create_player_for_account', { p_user: spare.id, p_team_entry_id: made.entry, p_first_name: `${tag}X`, p_last_name: who })).error?.code, who).toBe('42501');
    }
    expect((await as.dictator.db.from('players').insert({ first_name: `${tag}Direct`, last_name: 'Insert' })).error?.code).toBe('42501');
    expect((await admin.from('players').insert({ first_name: `${tag}Server`, last_name: 'Insert' })).error?.code).toBe('42501');
    expect((await admin.from('players').select('id').ilike('first_name', `${tag}X%`)).data).toEqual([]);
  });

  it('only linked players gain a roster place', async () => {
    const team2 = must(await admin.from('teams').insert({ name: `${tag} Two`, short_name: 'TWO' }).select('id').single()).data!.id;
    const nextSeason = must(await admin.from('seasons').insert({ visibility: 'public', division_id: made.division, slug: `${tag}-b`, name: `${tag} B`, is_current: false }).select('id').single()).data!.id;
    const entry2 = must(await admin.from('team_entries').insert({ team_id: team2, season_id: nextSeason }).select('id').single()).data!.id;
    try {
      const refused = await as.dictator.db.rpc('add_player_to_roster', { p_player: made.legacy[2], p_team_entry_id: entry2 });
      expect(refused.error?.code).toBe('23514');
      expect(refused.error?.message).toMatch(/not linked to an account/);
      expect((await admin.from('roster_memberships').insert({ player_id: made.legacy[2], team_entry_id: entry2, season_id: nextSeason })).error?.code).toBe('23514');
      const added = must(await as.dictator.db.rpc('add_player_to_roster', { p_player: made.legacy[0], p_team_entry_id: entry2, p_jersey_number: 5 }));
      expect(added.data).toBeTruthy();
      expect((await as.captain.db.rpc('add_player_to_roster', { p_player: made.legacy[1], p_team_entry_id: entry2 })).error?.code).toBe('42501');
    } finally {
      await admin.from('roster_memberships').delete().eq('season_id', nextSeason);
      await admin.from('team_entries').delete().eq('id', entry2);
      await admin.from('teams').delete().eq('id', team2);
      await admin.from('seasons').delete().eq('id', nextSeason);
    }
  });
});

describe('unlinking', () => {
  it('clears only the link; the player then has no email and no key', async () => {
    expect((await as.fan.db.rpc('unlink_player_account', { p_player: made.legacy[0] })).error?.code).toBe('42501');
    must(await as.dictator.db.rpc('unlink_player_account', { p_player: made.legacy[0] }));
    const status = (await as.dictator.db.rpc('player_link_status', { p_player_ids: [made.legacy[0]] })).data[0];
    expect(status).toMatchObject({ linked: false, email: null, has_key: false });
    expect((await admin.from('roster_memberships').select('id').eq('player_id', made.legacy[0])).data).toHaveLength(1);
    // With no key, the account's later activity never links it back on its own.
    expect((await ours()).some((m) => m.player_id === made.legacy[0])).toBe(false);
  });

  it('a dismissed key leaves the preview', async () => {
    expect((await as.captain.db.rpc('dismiss_player_link_key', { p_player: made.legacy[4] })).error?.code).toBe('42501');
    must(await as.dictator.db.rpc('dismiss_player_link_key', { p_player: made.legacy[4] }));
    expect((await ours()).some((m) => m.player_id === made.legacy[4])).toBe(false);
  });
});

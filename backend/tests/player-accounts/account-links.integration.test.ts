// Group: player-accounts. Account-linked players through the real local Data API, each account signed in with its own
// token: a dictator links a verified account, unlinks it and runs the dry-run import; a captain, an editor, a normal
// user and the server key cannot link, unlink or claim; nobody but the server reads the link; and a linked player edits
// only their own portrait and preferred foot, through the profile portrait route and update_my_player. After linking
// and a self-edit the same player and card show in rosters and season statistics. Only the media upload is replaced (no
// R2 locally); authorization and every write are real. Runs against THIS repository's local Supabase (127.0.0.1:54321).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clients, localKeys, uniqueEmail } from '../auth/local-supabase';

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
const uploaded: string[] = [];
vi.mock('@/lib/roster/playerImage', async (original) => {
  const real = await original<typeof import('@/lib/roster/playerImage')>();
  return {
    ...real,
    uploadPortrait: async (key: string) => { uploaded.push(key); return `https://media.example/${key}`; },
  };
});

const tag = `acct${Date.now().toString(36)}`;
let admin: SupabaseClient;
let anonClient: SupabaseClient;
const users: string[] = [];
const as: Record<string, { id: string; email: string; token: string; db: SupabaseClient }> = {};
const made = { division: '', season: '', team: '', entry: '', players: [] as string[] };

async function account(label: string, role: string, verified = true) {
  const email = uniqueEmail(`${tag}-${label}`);
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: verified });
  if (error) throw error;
  users.push(data.user.id);
  await admin.from('user_roles').update({ role }).eq('user_id', data.user.id);
  return { id: data.user.id, email };
}

async function signIn(label: string, role: string, c: ReturnType<typeof clients>) {
  const { id, email } = await account(label, role);
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const db = c.anon();
  const { data: v, error } = await db.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'magiclink' });
  if (error) throw error;
  return { id, email, token: v.session!.access_token, db };
}

const must = <T extends { error: unknown }>(r: T): T => {
  if (r.error) throw new Error(`setup failed: ${JSON.stringify(r.error)}`);
  return r;
};
const linkOf = async (player: string) => (await admin.from('players').select('user_id').eq('id', player).single()).data!.user_id as string | null;

async function portrait(who: string | null, image?: Buffer) {
  const { POST } = await import('../../app/api/profile/player-portrait/route');
  const form = new FormData();
  if (image) form.set('image', new File([new Uint8Array(image)], 'p.png', { type: 'image/png' }));
  const headers: Record<string, string> = who ? { Authorization: `Bearer ${as[who].token}` } : {};
  const res = await POST(new Request('http://localhost/api/profile/player-portrait', { method: 'POST', headers, body: form }));
  return { status: res.status, body: await res.json() };
}

// A valid 500 x 500 PNG (the portrait rule): the signature, an IHDR chunk with the size, and an end chunk.
function png500(): Buffer {
  const { deflateSync, crc32 } = require('node:zlib') as typeof import('node:zlib');
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(500, 0); ihdr.writeUInt32BE(500, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((500 * 3 + 1) * 500);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

beforeAll(async () => {
  const keys = localKeys();
  Object.assign(process.env, { SUPABASE_URL: keys.url, SUPABASE_PUBLISHABLE_KEY: keys.publishable, SUPABASE_SECRET_KEY: keys.secret });
  const c = clients(keys);
  admin = c.admin;
  anonClient = c.anon();
  for (const [label, role] of [['dictator', 'dictator'], ['captain', 'captain'], ['editor', 'editor'], ['fan', 'default'], ['other', 'default']]) {
    as[label] = await signIn(label, role, c);
  }
  made.division = must(await admin.from('divisions').insert({ slug: tag, name: `${tag} Division` }).select('id').single()).data!.id;
  made.season = must(await admin.from('seasons').insert({ division_id: made.division, slug: `${tag}-a`, name: `${tag} A`, is_current: true }).select('id').single()).data!.id;
  made.team = must(await admin.from('teams').insert({ name: `${tag} One`, short_name: 'ONE' }).select('id').single()).data!.id;
  made.entry = must(await admin.from('team_entries').insert({ team_id: made.team, season_id: made.season }).select('id').single()).data!.id;
  made.players = must(await admin.from('players').insert([
    { first_name: `${tag}Linked`, last_name: 'Lane', overall_rating: 70, attributes: { stats: { Pace: { total: 80 } }, playStyle: 'Power Shot' } },
    { first_name: `${tag}Second`, last_name: 'Player' },
  ]).select('id')).data!.map((p) => p.id);
  must(await admin.from('roster_memberships').insert({ player_id: made.players[0], team_entry_id: made.entry, season_id: made.season, jersey_number: 9, position: 'ST' }));
  must(await admin.from('player_private_details').insert({ player_id: made.players[1], email: as.other.email }));
}, 90000);

afterAll(async () => {
  if (!admin) return;
  await admin.from('roster_memberships').delete().eq('season_id', made.season);
  await admin.from('players').delete().in('id', made.players);
  await admin.from('team_entries').delete().eq('id', made.entry);
  await admin.from('teams').delete().eq('id', made.team);
  await admin.from('seasons').delete().eq('id', made.season);
  if (made.division) await admin.from('divisions').delete().eq('id', made.division);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 60000);

describe('linking a player to an account', () => {
  it('only a dictator links, and only a verified account', async () => {
    const unverified = await account('unverified', 'default', false);
    const refused = await as.dictator.db.rpc('link_player_account', { p_player: made.players[0], p_user: unverified.id });
    expect(refused.error?.code).toBe('23514');
    for (const who of ['captain', 'editor', 'fan']) {
      const r = await as[who].db.rpc('link_player_account', { p_player: made.players[0], p_user: as.fan.id });
      expect(r.error?.code, who).toBe('42501');
    }
    expect(await linkOf(made.players[0])).toBeNull();
    must(await as.dictator.db.rpc('link_player_account', { p_player: made.players[0], p_user: as.fan.id }));
    expect(await linkOf(made.players[0])).toBe(as.fan.id);
    const twice = await as.dictator.db.rpc('link_player_account', { p_player: made.players[1], p_user: as.fan.id });
    expect(twice.error?.code).toBe('23505');
  });

  it('nobody claims a player by writing the link directly, not even with the server key', async () => {
    const own = await as.other.db.from('players').update({ user_id: as.other.id }).eq('id', made.players[1]).select('id');
    expect(own.error).toBeTruthy();
    const server = await admin.from('players').update({ user_id: as.other.id }).eq('id', made.players[1]);
    expect(server.error?.code).toBe('42501');
    expect(await linkOf(made.players[1])).toBeNull();
  });

  it('nobody but the server reads the link; the public card still reads', async () => {
    expect((await anonClient.from('players').select('user_id').eq('id', made.players[0])).error).toBeTruthy();
    expect((await as.fan.db.from('players').select('user_id').eq('id', made.players[0])).error).toBeTruthy();
    const card = await anonClient.from('players').select('id, first_name, overall_rating').eq('id', made.players[0]).single();
    expect(card.data?.overall_rating).toBe(70);
    const status = await as.dictator.db.rpc('player_link_status', { p_player_ids: made.players });
    expect(status.data.find((s: { player_id: string }) => s.player_id === made.players[0])).toMatchObject({ linked: true, account_label: expect.stringContaining(as.fan.email) });
    expect((await as.captain.db.rpc('player_link_status', { p_player_ids: made.players })).data).toEqual([]);
  });

  it('the account search lists verified accounts with the player each is linked to', async () => {
    const r = await as.dictator.db.rpc('player_link_candidates', { p_query: `${tag}-fan` });
    expect(r.data).toEqual([expect.objectContaining({ user_id: as.fan.id, linked_player_id: made.players[0] })]);
    expect((await as.captain.db.rpc('player_link_candidates', { p_query: `${tag}-fan` })).data).toEqual([]);
  });
});

describe('a linked player edits their own card', () => {
  it('reads their own card and seasons', async () => {
    const me = must(await as.fan.db.rpc('my_player')).data;
    expect(me).toMatchObject({ id: made.players[0], overall_rating: 70, seasons: [expect.objectContaining({ team: `${tag} One`, jersey_number: 9, position: 'ST' })] });
    expect((await as.other.db.rpc('my_player')).data).toBeNull();
  });

  it('uploads a portrait for their own player only', async () => {
    expect((await portrait(null, png500())).status).toBe(401);
    expect((await portrait('other', png500())).status).toBe(403);
    expect((await portrait('fan')).status).toBe(400);
    const ok = await portrait('fan', png500());
    expect(ok.status).toBe(200);
    expect(ok.body.imageUrl).toBe(`https://media.example/players/${made.players[0]}.png`);
    expect(uploaded).toEqual([`players/${made.players[0]}.png`]);
  });

  it('saves only the portrait and preferred foot; everything else stays', async () => {
    must(await as.fan.db.rpc('update_my_player', { p_image_url: `https://media.example/players/${made.players[0]}.png`, p_preferred_foot: 'Left' }));
    const row = (await admin.from('players').select('image_url, overall_rating, attributes, first_name').eq('id', made.players[0]).single()).data!;
    expect(row).toEqual({ image_url: `https://media.example/players/${made.players[0]}.png`, overall_rating: 70, first_name: `${tag}Linked`,
      attributes: { stats: { Pace: { total: 80 } }, playStyle: 'Power Shot', bio: { preferredFoot: 'Left' } } });
    const other = await as.fan.db.rpc('update_my_player', { p_image_url: `https://media.example/players/${made.players[1]}.png`, p_preferred_foot: 'Left' });
    expect(other.error?.code).toBe('22023');
    const direct = await as.fan.db.from('players').update({ overall_rating: 99 }).eq('id', made.players[0]).select('id');
    expect(direct.data ?? []).toEqual([]); // row level security: a player has no direct write
    expect((await as.other.db.rpc('update_my_player', { p_image_url: null, p_preferred_foot: 'Right' })).error?.code).toBe('42501');
  });

  it('the self-edit and the link are in the audit history, without emails', async () => {
    const { data } = await admin.from('audit_log').select('actor_id, changes').eq('table_name', 'players').eq('record_id', made.players[0]);
    expect(data!.some((r) => r.actor_id === as.dictator.id && 'user_id' in (r.changes ?? {}))).toBe(true);
    expect(data!.some((r) => r.actor_id === as.fan.id && 'image_url' in (r.changes ?? {}))).toBe(true);
    expect(JSON.stringify(data)).not.toContain('@');
  });

  it('the same player and card appear in the roster after linking and editing', async () => {
    const { data } = await anonClient.from('roster_memberships').select('jersey_number, player:players ( id, image_url )').eq('team_entry_id', made.entry);
    expect(data).toEqual([{ jersey_number: 9, player: { id: made.players[0], image_url: `https://media.example/players/${made.players[0]}.png` } }]);
  });
});

describe('the account-link import and unlinking', () => {
  it('previews every row, writes nothing on a problem, links a clean file once', async () => {
    const rows = [{ player_id: made.players[1], email: '' }, { player_id: made.players[0], email: as.fan.email }, { player_id: 'nope', email: 'x' }];
    const preview = must(await as.dictator.db.rpc('preview_player_account_links', { p_rows: rows })).data;
    expect(preview.map((r: { status: string }) => r.status)).toEqual(['ready', 'already_linked', 'invalid_row']);
    expect((await as.dictator.db.rpc('apply_player_account_links', { p_rows: rows })).error).toBeTruthy();
    expect(await linkOf(made.players[1])).toBeNull();
    expect((await as.captain.db.rpc('preview_player_account_links', { p_rows: rows })).error?.code).toBe('42501');
    const clean = rows.slice(0, 2);
    expect(must(await as.dictator.db.rpc('apply_player_account_links', { p_rows: clean })).data).toBe(1);
    expect(await linkOf(made.players[1])).toBe(as.other.id); // the blank email used the dictator-entered contact email
    expect(must(await as.dictator.db.rpc('apply_player_account_links', { p_rows: clean })).data).toBe(0);
  });

  it('unlinking clears only the link, by a dictator only', async () => {
    expect((await as.fan.db.rpc('unlink_player_account', { p_player: made.players[0] })).error?.code).toBe('42501');
    must(await as.dictator.db.rpc('unlink_player_account', { p_player: made.players[0] }));
    const row = (await admin.from('players').select('user_id, image_url, overall_rating').eq('id', made.players[0]).single()).data!;
    expect(row).toEqual({ user_id: null, image_url: `https://media.example/players/${made.players[0]}.png`, overall_rating: 70 });
    expect((await admin.from('roster_memberships').select('id').eq('player_id', made.players[0])).data).toHaveLength(1);
    expect((await as.fan.db.rpc('my_player')).data).toBeNull();
  });
});

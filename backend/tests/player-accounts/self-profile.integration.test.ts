// Group: player-accounts. A linked player's own card through the real local Data API and the profile portrait route:
// they read their card, seasons and their Auth email (read-only), upload a portrait only for their own player and
// change only their portrait and preferred foot (never name, rating, stats, play style or email); an unlinked user is
// refused. After linking and a self-edit the same identity and card appear in the roster, match goals, season
// statistics and the public player page. Only the media upload is replaced (no R2 locally). Runs against THIS
// repository's local Supabase (127.0.0.1:54321).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clients, localKeys, uniqueEmail } from '../auth/local-supabase';

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
const uploaded: string[] = [];
vi.mock('@/lib/roster/playerImage', async (original) => {
  const real = await original<typeof import('@/lib/roster/playerImage')>();
  return { ...real, uploadPortrait: async (key: string) => { uploaded.push(key); return `https://media.example/${key}`; } };
});

const tag = `self${Date.now().toString(36)}`;
let admin: SupabaseClient;
const users: string[] = [];
const as: Record<string, { id: string; email: string; token: string; db: SupabaseClient }> = {};
const made = { division: '', season: '', teams: [] as string[], entry: '', player: '', other: '', match: '' };

async function signIn(label: string, role: string, c: ReturnType<typeof clients>) {
  const { data, error } = await admin.auth.admin.createUser({ email: uniqueEmail(`${tag}-${label}`), email_confirm: true });
  if (error) throw error;
  users.push(data.user.id);
  if (role !== 'default') await admin.from('user_roles').upsert({ user_id: data.user.id, role: role }, { onConflict: 'user_id,role', ignoreDuplicates: true });
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: data.user.email! });
  const db = c.anon();
  const v = await db.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'magiclink' });
  if (v.error) throw v.error;
  return { id: data.user.id, email: data.user.email!, token: v.data.session!.access_token, db };
}
const must = <T extends { error: unknown }>(r: T): T => {
  if (r.error) throw new Error(`setup failed: ${JSON.stringify(r.error)}`);
  return r;
};

async function portrait(who: string | null, image?: Buffer) {
  const { POST } = await import('../../app/api/profile/player-portrait/route');
  const form = new FormData();
  if (image) form.set('image', new File([new Uint8Array(image)], 'p.png', { type: 'image/png' }));
  const headers: Record<string, string> = who ? { Authorization: `Bearer ${as[who].token}` } : {};
  const res = await POST(new Request('http://localhost/api/profile/player-portrait', { method: 'POST', headers, body: form }));
  return { status: res.status, body: await res.json() };
}

// A valid 500 x 500 PNG (the portrait rule).
async function png500(): Promise<Buffer> {
  const { deflateSync, crc32 } = await import('node:zlib');
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(500, 0); ihdr.writeUInt32BE(500, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc((500 * 3 + 1) * 500))), chunk('IEND', Buffer.alloc(0))]);
}

beforeAll(async () => {
  const keys = localKeys();
  Object.assign(process.env, { SUPABASE_URL: keys.url, SUPABASE_PUBLISHABLE_KEY: keys.publishable, SUPABASE_SECRET_KEY: keys.secret });
  const c = clients(keys);
  admin = c.admin;
  for (const [label, role] of [['dictator', 'dictator'], ['player', 'default'], ['other', 'default'], ['nobody', 'captain']]) as[label] = await signIn(label, role, c);
  made.division = must(await admin.from('divisions').insert({ slug: tag, name: `${tag} Division` }).select('id').single()).data!.id;
  made.season = must(await admin.from('seasons').insert({ division_id: made.division, slug: `${tag}-a`, name: `${tag} A`, is_current: true }).select('id').single()).data!.id;
  made.teams = must(await admin.from('teams').insert([{ name: `${tag} One`, short_name: 'ONE' }, { name: `${tag} Two`, short_name: 'TWO' }]).select('id')).data!.map((t) => t.id);
  const entries = must(await admin.from('team_entries').insert(made.teams.map((team_id) => ({ team_id, season_id: made.season }))).select('id')).data!.map((e) => e.id);
  made.entry = entries[0];
  made.player = must(await as.dictator.db.rpc('create_player_for_account', {
    p_user: as.player.id, p_team_entry_id: made.entry, p_first_name: `${tag}Linked`, p_last_name: 'Lane', p_jersey_number: 9, p_position: 'ST',
    p_overall_rating: 70, p_attributes: { stats: { Pace: { total: 80 } }, playStyle: 'Power Shot' },
  })).data;
  made.other = must(await as.dictator.db.rpc('create_player_for_account', {
    p_user: as.other.id, p_team_entry_id: entries[1], p_first_name: `${tag}Other`, p_last_name: 'Player',
  })).data;
  made.match = must(await admin.from('matches').insert({ home_team_id: made.teams[0], away_team_id: made.teams[1], season_id: made.season, status: 'completed' }).select('id').single()).data!.id;
  must(await admin.from('match_events').insert({ match_id: made.match, team_id: made.teams[0], kind: 'goal', player_id: made.player, minute: 12 }));
}, 120000);

afterAll(async () => {
  if (!admin) return;
  if (made.match) await admin.from('matches').delete().eq('id', made.match); // its events go with it
  await admin.from('roster_memberships').delete().eq('season_id', made.season);
  await admin.from('players').delete().in('id', [made.player, made.other].filter(Boolean));
  await admin.from('team_entries').delete().eq('season_id', made.season);
  await admin.from('teams').delete().in('id', made.teams);
  await admin.from('seasons').delete().eq('id', made.season);
  if (made.division) await admin.from('divisions').delete().eq('id', made.division);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 60000);

describe('a linked player edits their own card', () => {
  it('reads their own card, seasons and Auth email', async () => {
    const me = must(await as.player.db.rpc('my_player')).data;
    expect(me).toMatchObject({ id: made.player, overall_rating: 70, email: as.player.email, seasons: [expect.objectContaining({ team: `${tag} One`, jersey_number: 9, position: 'ST' })] });
    expect((await as.nobody.db.rpc('my_player')).data).toBeNull();
  });

  it('uploads a portrait for their own player only', async () => {
    const image = await png500();
    expect((await portrait(null, image)).status).toBe(401);
    expect((await portrait('nobody', image)).status).toBe(403);
    expect((await portrait('player')).status).toBe(400);
    const ok = await portrait('player', image);
    expect(ok.status).toBe(200);
    expect(ok.body.imageUrl).toBe(`https://media.example/players/${made.player}.png`);
    expect(uploaded).toEqual([`players/${made.player}.png`]);
  });

  it('saves only the portrait and preferred foot; name, rating, stats, play style and email stay', async () => {
    must(await as.player.db.rpc('update_my_player', { p_image_url: `https://media.example/players/${made.player}.png`, p_preferred_foot: 'Left' }));
    const row = (await admin.from('players').select('image_url, overall_rating, attributes, first_name, user_id').eq('id', made.player).single()).data!;
    expect(row).toEqual({ image_url: `https://media.example/players/${made.player}.png`, overall_rating: 70, first_name: `${tag}Linked`, user_id: as.player.id,
      attributes: { stats: { Pace: { total: 80 } }, playStyle: 'Power Shot', bio: { preferredFoot: 'Left' } } });
    expect((await as.player.db.rpc('update_my_player', { p_image_url: `https://media.example/players/${made.other}.png`, p_preferred_foot: 'Left' })).error?.code).toBe('22023');
    expect((await as.player.db.from('players').update({ overall_rating: 99 }).eq('id', made.player).select('id')).data ?? []).toEqual([]);
    expect((await as.nobody.db.rpc('update_my_player', { p_image_url: null, p_preferred_foot: 'Right' })).error?.code).toBe('42501');
    // There is no email to edit: it is the account's, and the player cannot write the link.
    expect((await as.player.db.from('players').update({ user_id: as.other.id } as any).eq('id', made.player).select('id')).error).toBeTruthy();
  });
});

describe('one identity everywhere', () => {
  it('the linked, self-edited card is the same player in the roster, goals, season statistics and the public player page', async () => {
    const place = (await admin.from('roster_memberships').select('player:players ( id, image_url )').eq('team_entry_id', made.entry)).data;
    expect(place).toEqual([{ player: { id: made.player, image_url: `https://media.example/players/${made.player}.png` } }]);
    expect((await admin.from('match_events').select('player_id').eq('match_id', made.match)).data).toEqual([{ player_id: made.player }]);
    const stats = (await admin.from('season_player_stats').select('player_id, goals').eq('season_id', made.season).eq('player_id', made.player)).data;
    expect(stats).toEqual([{ player_id: made.player, goals: 1 }]);
    const { GET } = await import('../../app/api/players/[player_id]/route');
    const res = await GET(new Request(`http://localhost/api/players/${made.player}`), { params: Promise.resolve({ player_id: made.player }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(JSON.stringify(body)).toContain(`${tag}Linked`);
    expect(JSON.stringify(body)).not.toContain(as.player.email);
  });
});

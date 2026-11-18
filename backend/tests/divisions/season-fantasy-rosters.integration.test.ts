// Group: divisions. Rosters, the fantasy schedule, a user's predictions and fantasy points all belong to a season.
// Each route handler runs for real against THIS repository's local Supabase stack: a second WSL season gets its own
// roster, match and graded prediction, and nothing of it may appear in (or change) the 2026 season.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clients, localKeys, uniqueEmail } from '../auth/local-supabase';

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));

const tag = `fant${Date.now().toString(36)}`;
let admin: SupabaseClient;
let fan: { id: string; token: string };
const made = { season: '', teams: [] as string[], entries: [] as string[], players: [] as string[], matches: [] as string[] };

const must = <T extends { error: unknown }>(r: T): T => {
  if (r.error) throw new Error(`setup failed: ${JSON.stringify(r.error)}`);
  return r;
};

async function route(path: string) {
  return (await import(`../../app/api/${path}/route`)) as any;
}
const get = async (path: string, query: string, token?: string) => {
  const { GET } = await route(path);
  const res: Response = await GET(new Request(`http://localhost/api/${path}?${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }));
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  const keys = localKeys();
  Object.assign(process.env, { SUPABASE_URL: keys.url, SUPABASE_PUBLISHABLE_KEY: keys.publishable, SUPABASE_SECRET_KEY: keys.secret });
  const c = clients(keys);
  admin = c.admin;

  const email = uniqueEmail('season-fan');
  const created = must(await admin.auth.admin.createUser({ email, email_confirm: true }));
  const link = must(await admin.auth.admin.generateLink({ type: 'magiclink', email }));
  const v = must(await c.anon().auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'magiclink' }));
  fan = { id: created.data.user!.id, token: v.data.session!.access_token };
  must(await admin.from('user_profiles').update({ nickname: `${tag}fan` }).eq('id', fan.id));

  const wsl = must(await admin.from('divisions').select('id').eq('slug', 'wsl').single()).data!;
  made.season = must(await admin.from('seasons').insert({ division_id: wsl.id, slug: `${tag}-2027`, name: '2027' }).select('id').single()).data!.id;
  made.teams = must(await admin.from('teams').insert([{ name: `${tag} North`, short_name: 'NOR' }, { name: `${tag} South`, short_name: 'SOU' }]).select('id')).data!.map((t) => t.id);
  made.entries = must(await admin.from('team_entries').insert(made.teams.map((team_id) => ({ team_id, season_id: made.season }))).select('id')).data!.map((e) => e.id);
  made.players = must(await admin.from('players').insert([
    { team_id: made.teams[0], team_entry_id: made.entries[0], first_name: tag, last_name: 'Keeper' },
    { team_id: made.teams[1], team_entry_id: made.entries[1], first_name: tag, last_name: 'Winger' },
  ]).select('id')).data!.map((p) => p.id);
  made.matches = must(await admin.from('matches').insert([
    { home_team_id: made.teams[0], away_team_id: made.teams[1], season_id: made.season, status: 'scheduled', date: '2027-03-01T12:00:00Z' },
    { home_team_id: made.teams[1], away_team_id: made.teams[0], season_id: made.season, status: 'completed', home_score: 1, away_score: 0, date: '2027-02-01T12:00:00Z', scorers: [], assists: [] },
  ], { defaultToNull: false }).select('id')).data!.map((m) => m.id);
  must(await admin.from('predictions').insert({ user_id: fan.id, match_id: made.matches[1], predicted_home_score: 1, predicted_away_score: 0 }));
}, 60000);

afterAll(async () => {
  if (!admin) return;
  for (const id of made.matches) await admin.from('matches').delete().eq('id', id); // predictions cascade
  for (const id of made.players) await admin.from('players').delete().eq('id', id);
  if (made.season) await admin.from('team_entries').delete().eq('season_id', made.season);
  for (const id of made.teams) await admin.from('teams').delete().eq('id', id);
  if (made.season) await admin.from('seasons').delete().eq('id', made.season);
  if (fan) await admin.auth.admin.deleteUser(fan.id);
}, 60000);

describe('season rosters', () => {
  it('lists only the chosen season\'s roster', async () => {
    const next = await get('players', `division=wsl&season=${tag}-2027`);
    expect(next.status).toBe(200);
    expect(next.body.data.map((p: any) => p.last_name).sort()).toEqual(['Keeper', 'Winger']);
    const current = await get('players', 'division=wsl');
    expect(current.body.data).toHaveLength(64);
    expect(current.body.data.map((p: any) => p.last_name)).not.toContain('Keeper');
    const freshers = await get('players', 'division=freshers');
    expect(freshers.body.data.length).toBeGreaterThan(64); // the players roster plus the registration rosters
  });

  it('a player profile names its season and counts that season\'s goals', async () => {
    const { GET } = await route('players/[player_id]');
    const res: Response = await GET(new Request('http://localhost/api/players/x'), { params: Promise.resolve({ player_id: made.players[0] }) });
    const body = await res.json();
    expect(body.data ?? body.player ?? body).toBeTruthy();
    const player = body.data ?? body.player;
    expect(player.season).toMatchObject({ name: '2027', division: { slug: 'wsl' } });
    expect(player.goals).toBe(0);
  });
});

describe('season fantasy', () => {
  it('the fantasy schedule shows only the season\'s open matches', async () => {
    const next = await get('schedule', `division=wsl&season=${tag}-2027`);
    expect(next.body.data.map((m: any) => m.id)).toEqual([made.matches[0]]);
    const current = await get('schedule', 'division=wsl&limit=100');
    expect(current.body.data.map((m: any) => m.id)).not.toContain(made.matches[0]);
  });

  it('grading a match changes only that season\'s points, and the leaderboard ranks per season', async () => {
    const { POST } = await route('admin/predictions/grade');
    const graded = await POST(new Request('http://localhost/api/admin/predictions/grade', {
      method: 'POST', headers: { Authorization: `Bearer ${fan.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ match_id: made.matches[1] }),
    }));
    expect(graded.status).toBe(200);
    const { data: pred } = await admin.from('predictions').select('points_awarded, status').eq('match_id', made.matches[1]).single();
    expect(pred!.status).toBe('graded');
    expect(pred!.points_awarded).toBeGreaterThan(0);

    const next = await get('predictions/leaderboard', `division=wsl&season=${tag}-2027`);
    expect(next.body.data.overall).toEqual([expect.objectContaining({ user_id: fan.id, total_points: pred!.points_awarded })]);
    const current = await get('predictions/leaderboard', 'division=wsl');
    expect(current.body.data.overall.map((e: any) => e.user_id)).not.toContain(fan.id);
    expect(current.body.data.scope.season.slug).toBe('2026');

    const home = await get('home/dashboard', `division=wsl&season=${tag}-2027`);
    expect(home.body.data.fantasyTop).toEqual([expect.objectContaining({ id: fan.id, points: pred!.points_awarded })]);
  });

  it('a user\'s prediction history is the chosen season\'s', async () => {
    const next = await get('predictions/history', `division=wsl&season=${tag}-2027`, fan.token);
    expect(next.status).toBe(200);
    expect(next.body.data.map((p: any) => p.match_id)).toEqual([made.matches[1]]);
    const current = await get('predictions/history', 'division=wsl', fan.token);
    expect(current.body.data).toEqual([]);
  });
});

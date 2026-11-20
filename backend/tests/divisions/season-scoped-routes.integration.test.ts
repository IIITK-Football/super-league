// Group: divisions. The public API routes read divisions and seasons, not the retired division strings. Each route
// handler runs for real against THIS repository's local Supabase stack (127.0.0.1:54321): a second WSL season with
// its own teams, match and goal is created, and every route must scope to the requested season, default to the
// current one, and refuse unknown, hidden or legacy names.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clients, localKeys } from '../auth/local-supabase';
import { insertLocal } from '../local-fixtures';

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));

const tag = `scope${Date.now().toString(36)}`;
const LAMB = '60000000-0000-4000-8000-000000000001'; // seeded fixture account with fantasy points
let admin: SupabaseClient;
let routes: Record<string, (request: Request) => Promise<Response>>;
const made = { seasons: [] as string[], teams: [] as string[], players: [] as string[], matches: [] as string[] };
let wsl: { id: string };

const must = <T extends { error: unknown }>(r: T): T => {
  if (r.error) throw new Error(`setup failed: ${JSON.stringify(r.error)}`);
  return r;
};

const call = async (name: string, query: string) => {
  const res = await routes[name](new Request(`http://localhost/api/${name}?${query}`));
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  const keys = localKeys();
  process.env.SUPABASE_URL = keys.url;
  process.env.SUPABASE_PUBLISHABLE_KEY = keys.publishable;
  process.env.SUPABASE_SECRET_KEY = keys.secret;
  admin = clients(keys).admin;
  routes = {
    'home/dashboard': (await import('../../app/api/home/dashboard/route')).GET,
    standings: (await import('../../app/api/standings/route')).GET,
    teams: (await import('../../app/api/teams/route')).GET,
    leaderboard: (await import('../../app/api/leaderboard/route')).GET,
    legends: (await import('../../app/api/legends/route')).GET as unknown as (r: Request) => Promise<Response>,
    'predictions/leaderboard': (await import('../../app/api/predictions/leaderboard/route')).GET,
  };

  wsl = (await admin.from('divisions').select('id').eq('slug', 'wsl').single()).data!;
  const { data: seasons } = must(await admin.from('seasons').insert([
    { division_id: wsl.id, slug: `${tag}-2027`, name: '2027', status: 'planned' },
    { division_id: wsl.id, slug: `${tag}-hidden`, name: 'Hidden', visibility: 'hidden' },
  ], { defaultToNull: false }).select('id, slug'));
  made.seasons = seasons!.map((s) => s.id);
  const next = seasons!.find((s) => s.slug === `${tag}-2027`)!.id;

  const { data: teams } = must(await admin.from('teams').insert([
    { name: `${tag} Rovers`, short_name: 'ROV' },
    { name: `${tag} United`, short_name: 'UTD' },
  ]).select('id, name'));
  made.teams = teams!.map((t) => t.id);
  must(await admin.from('team_entries').insert(made.teams.map((team_id) => ({ team_id, season_id: next }))));

  // Legacy players without an account, written as the seed writes them.
  made.players = insertLocal<{ id: string }>('players', [
    { first_name: tag, last_name: 'Striker' },
    { first_name: tag, last_name: 'Creator' },
  ]).map((p) => p.id);
  const rovers = must(await admin.from('team_entries').select('id').eq('team_id', made.teams[0]).eq('season_id', next).single()).data!;
  insertLocal('roster_memberships', made.players.map((player_id, i) => ({ player_id, team_entry_id: rovers.id, season_id: next, jersey_number: i + 1 })));
  const { data: match } = must(await admin.from('matches').insert({
    home_team_id: made.teams[0], away_team_id: made.teams[1], season_id: next,
    status: 'completed', date: '2027-02-01T12:00:00Z',
  }).select('id').single());
  made.matches = [match!.id];
  must(await admin.from('match_events').insert({ match_id: match!.id, team_id: made.teams[0], kind: 'goal', player_id: made.players[0], assist_player_id: made.players[1], minute: 10 }));
  must(await admin.from('division_flairs').upsert({ user_id: LAMB, division_id: wsl.id, team_name: 'Falcone Family' }));
}, 60000);

afterAll(async () => {
  if (!admin) return;
  await admin.from('division_flairs').delete().eq('user_id', LAMB).eq('division_id', wsl?.id ?? '');
  for (const id of made.matches) await admin.from('matches').delete().eq('id', id); // its events go with it
  await admin.from('roster_memberships').delete().in('season_id', made.seasons);
  for (const id of made.players) await admin.from('players').delete().eq('id', id);
  await admin.from('team_entries').delete().in('season_id', made.seasons);
  for (const id of made.teams) await admin.from('teams').delete().eq('id', id);
  for (const id of made.seasons) await admin.from('seasons').delete().eq('id', id);
}, 60000);

describe('home dashboard', () => {
  it('defaults to Super League and its current 2026 season', async () => {
    const { status, body } = await call('home/dashboard', '');
    expect(status).toBe(200);
    expect(body.data.scope.division.slug).toBe('super-league');
    expect(body.data.scope.season).toMatchObject({ slug: '2026', is_current: true });
    expect(body.data.standings).toHaveLength(4);
    expect(body.data.topScorer?.stat).toBeGreaterThan(0);
  });

  it('shows only the chosen season: its teams, its top scorer and assister', async () => {
    const { status, body } = await call('home/dashboard', `division=wsl&season=${tag}-2027`);
    expect(status).toBe(200);
    expect(body.data.scope.season.name).toBe('2027');
    expect(body.data.standings.map((t: any) => t.teamName).sort()).toEqual([`${tag} Rovers`, `${tag} United`]);
    expect(body.data.topScorer).toMatchObject({ name: `${tag} Striker`, stat: 1 });
    expect(body.data.topAssist).toMatchObject({ name: `${tag} Creator`, stat: 1 });
    expect(body.data.liveMatch).toBeNull();
  });

  it('without a season shows the current season, not the new one', async () => {
    const { body } = await call('home/dashboard', 'division=wsl');
    expect(body.data.scope.season.slug).toBe('2026');
    expect(body.data.standings.map((t: any) => t.teamName)).not.toContain(`${tag} Rovers`);
  });

  it('shows each fantasy leader with their flair for this division', async () => {
    const { body } = await call('home/dashboard', 'division=wsl');
    const lamb = body.data.fantasyTop.find((u: any) => u.id === LAMB);
    if (lamb) expect(lamb.flair).toBe('Falcone Family');
    const sl = await call('home/dashboard', 'division=super-league');
    expect(sl.body.data.fantasyTop.find((u: any) => u.id === LAMB)?.flair ?? null).toBeNull();
  });

  it('refuses the retired division strings, unknown and hidden seasons, and malformed names', async () => {
    expect((await call('home/dashboard', 'division=mens')).status).toBe(404);
    expect((await call('home/dashboard', 'division=womens')).status).toBe(404);
    expect((await call('home/dashboard', 'division=wsl&season=1999')).status).toBe(404);
    expect((await call('home/dashboard', `division=wsl&season=${tag}-hidden`)).status).toBe(404);
    expect((await call('home/dashboard', 'division=wsl&season=Bad%20Slug')).status).toBe(400);
    expect((await call('home/dashboard', 'division=Not%20A%20Slug')).status).toBe(400);
  });
});

describe('standings, teams and statistics', () => {
  it('standings are the season\'s own table and schedule', async () => {
    const { status, body } = await call('standings', `division=wsl&season=${tag}-2027`);
    expect(status).toBe(200);
    expect(body.data.standings).toHaveLength(2);
    expect(body.data.standings[0]).toMatchObject({ teamName: `${tag} Rovers`, stats: expect.objectContaining({ points: 3 }) });
    expect(body.data.bracketMatches).toHaveLength(1);
    const current = await call('standings', 'division=super-league');
    expect(current.body.data.standings).toHaveLength(8);
  });

  it('teams are the teams entered in the season', async () => {
    const { body } = await call('teams', `division=wsl&season=${tag}-2027`);
    expect(body.data.map((t: any) => t.name).sort()).toEqual([`${tag} Rovers`, `${tag} United`]);
    expect((await call('teams', 'division=freshers')).body.data).toHaveLength(8);
  });

  it('the statistics leaderboard counts the season\'s goals', async () => {
    const { body } = await call('leaderboard', `division=wsl&season=${tag}-2027`);
    expect(body.data.topScorers[0]).toMatchObject({ name: `${tag} Striker`, goalsScored: 1 });
    const sl = await call('leaderboard', 'division=super-league');
    const { data: best } = await admin.from('season_player_stats').select('goals')
      .eq('season_id', sl.body.data.topScorers.length ? (await admin.from('seasons').select('id').eq('is_current', true).eq('division_id',
        (await admin.from('divisions').select('id').eq('slug', 'super-league').single()).data!.id).single()).data!.id : '')
      .order('goals', { ascending: false }).limit(1);
    expect(sl.body.data.topScorers[0].goalsScored).toBe(best![0].goals);
  });

  it('a season played with registration rosters (Freshers) reports its players from the same source', async () => {
    const { status, body } = await call('leaderboard', 'division=freshers');
    expect(status).toBe(200);
    expect(body.data.topScorers.length).toBeGreaterThan(0);
    const season = (await admin.from('seasons').select('id').eq('is_current', true)
      .eq('division_id', (await admin.from('divisions').select('id').eq('slug', 'freshers').single()).data!.id).single()).data!;
    const { data: best } = await admin.from('season_player_stats').select('goals').eq('season_id', season.id).order('goals', { ascending: false }).limit(1);
    expect(body.data.topScorers[0].goalsScored).toBe(best![0].goals);
  });

  it('legends add a player\'s goals up across every season', async () => {
    const { body } = await routes.legends(new Request('http://localhost/api/legends')).then(async (r) => ({ body: await r.json() }));
    expect(body.data.length).toBeGreaterThan(0);
    const goals = body.data.map((p: any) => p.goalsScored);
    expect(goals).toEqual([...goals].sort((a: number, b: number) => b - a));
  });

  it('the fantasy leaderboard shows flairs of the requested division', async () => {
    const wslBoard = await call('predictions/leaderboard', 'division=wsl');
    expect(wslBoard.body.data.overall.find((e: any) => e.user_id === LAMB)?.flair).toBe('Falcone Family');
    const slBoard = await call('predictions/leaderboard', 'division=super-league');
    expect(slBoard.body.data.overall.find((e: any) => e.user_id === LAMB)?.flair).toBeNull();
  });
});

// Group: rosters. Goals and assists are season facts, never stored on the reusable player identity. One player with
// roster places in two seasons scores in each; every reader (season roster, statistics leaderboard, home dashboard,
// player page, legends) shows only the requested season's numbers, the player page adds a career line that is the
// sum of the seasons, and legends equal the sum of the season lines. Runs against THIS repository's local Supabase
// stack (127.0.0.1:54321).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clients, localKeys } from '../auth/local-supabase';
import { insertLocal } from '../local-fixtures';

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));

const tag = `stats${Date.now().toString(36)}`;
let admin: SupabaseClient;
const made = { seasons: [] as string[], teams: [] as string[], entries: [] as string[], player: '', rival: '', matches: [] as string[] };
const must = <T extends { error: unknown }>(r: T): T => {
  if (r.error) throw new Error(`setup failed: ${JSON.stringify(r.error)}`);
  return r;
};
const route = async (name: string) => import(`../../app/api/${name}/route`);
const get = async (name: string, query = '') => {
  const { GET } = await route(name);
  const res: Response = await GET(new Request(`http://localhost/api/${name}?${query}`));
  return { status: res.status, body: await res.json() };
};
const playerPage = async (query = '') => {
  const { GET } = await route('players/[player_id]');
  const res: Response = await GET(new Request(`http://localhost/api/players/${made.player}?${query}`), { params: Promise.resolve({ player_id: made.player }) });
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  const keys = localKeys();
  process.env.SUPABASE_URL = keys.url;
  process.env.SUPABASE_PUBLISHABLE_KEY = keys.publishable;
  process.env.SUPABASE_SECRET_KEY = keys.secret;
  admin = clients(keys).admin;

  // Season A (WSL) and season B (Freshers): two divisions, one player identity.
  const wsl = must(await admin.from('divisions').select('id').eq('slug', 'wsl').single()).data!;
  const freshers = must(await admin.from('divisions').select('id').eq('slug', 'freshers').single()).data!;
  made.seasons = must(await admin.from('seasons').insert([
    { division_id: wsl.id, slug: `${tag}-a`, name: `${tag} A`, starts_on: '2027-01-01' },
    { division_id: freshers.id, slug: `${tag}-b`, name: `${tag} B`, starts_on: '2028-01-01' },
  ]).select('id')).data!.map((s) => s.id);
  made.teams = must(await admin.from('teams').insert([
    { name: `${tag} Alpha`, short_name: 'ALP' }, { name: `${tag} Beta`, short_name: 'BET' },
    { name: `${tag} Gamma`, short_name: 'GAM' }, { name: `${tag} Delta`, short_name: 'DEL' },
  ]).select('id')).data!.map((t) => t.id);
  made.entries = must(await admin.from('team_entries').insert([
    { team_id: made.teams[0], season_id: made.seasons[0] }, { team_id: made.teams[1], season_id: made.seasons[0] },
    { team_id: made.teams[2], season_id: made.seasons[1] }, { team_id: made.teams[3], season_id: made.seasons[1] },
  ]).select('id')).data!.map((e) => e.id);
  // Legacy players without an account, written as the seed writes them.
  const ids = insertLocal<{ id: string }>('players', [{ first_name: tag, last_name: 'Traveller' }, { first_name: tag, last_name: 'Helper' }]);
  made.player = ids[0].id;
  made.rival = ids[1].id;
  insertLocal('roster_memberships', [
    { player_id: made.player, team_entry_id: made.entries[0], season_id: made.seasons[0], jersey_number: 9, position: 'ST' },
    { player_id: made.rival, team_entry_id: made.entries[0], season_id: made.seasons[0], jersey_number: 8, position: 'CM' },
    { player_id: made.player, team_entry_id: made.entries[2], season_id: made.seasons[1], jersey_number: 10, position: 'CF' },
  ]);
  made.matches = must(await admin.from('matches').insert([
    { home_team_id: made.teams[0], away_team_id: made.teams[1], season_id: made.seasons[0], status: 'completed', date: '2027-02-01T12:00:00Z' },
    { home_team_id: made.teams[2], away_team_id: made.teams[3], season_id: made.seasons[1], status: 'completed', date: '2028-02-01T12:00:00Z' },
  ], { defaultToNull: false }).select('id')).data!.map((m) => m.id);
  must(await admin.from('match_events').insert([
    { match_id: made.matches[0], team_id: made.teams[0], kind: 'goal', player_id: made.player, assist_player_id: made.rival, minute: 10 },
    { match_id: made.matches[0], team_id: made.teams[0], kind: 'goal', player_id: made.player, minute: 70 },
    { match_id: made.matches[0], team_id: made.teams[0], kind: 'goal', player_id: made.rival, assist_player_id: made.player, minute: 80 },
    { match_id: made.matches[1], team_id: made.teams[2], kind: 'goal', player_id: made.player, minute: 15 },
  ]));
}, 60000);

afterAll(async () => {
  if (!admin) return;
  for (const id of made.matches) await admin.from('matches').delete().eq('id', id); // its events go with it
  await admin.from('roster_memberships').delete().in('season_id', made.seasons);
  await admin.from('players').delete().in('id', [made.player, made.rival].filter(Boolean));
  await admin.from('team_entries').delete().in('season_id', made.seasons);
  await admin.from('teams').delete().in('id', made.teams);
  await admin.from('seasons').delete().in('id', made.seasons);
}, 60000);

describe('season-specific statistics', () => {
  it('the season roster lists each season\'s own goals and assists', async () => {
    const a = await get('players', `division=wsl&season=${tag}-a`);
    expect(a.status).toBe(200);
    expect(a.body.data.find((p: any) => p.id === made.player)).toMatchObject({ goals: 2, assists: 1, jersey_number: 9, position: 'ST', team: `${tag} Alpha` });
    const b = await get('players', `division=freshers&season=${tag}-b`);
    expect(b.body.data.find((p: any) => p.id === made.player)).toMatchObject({ goals: 1, assists: 0, jersey_number: 10, position: 'CF', team: `${tag} Gamma` });
  });

  it('the statistics leaderboard shows the requested season only', async () => {
    const a = await get('leaderboard', `division=wsl&season=${tag}-a`);
    expect(a.body.data.topScorers[0]).toMatchObject({ id: made.player, goalsScored: 2, club: `${tag} Alpha` });
    const b = await get('leaderboard', `division=freshers&season=${tag}-b`);
    expect(b.body.data.topScorers[0]).toMatchObject({ id: made.player, goalsScored: 1, club: `${tag} Gamma` });
  });

  it('the home dashboard\'s top scorer is the season\'s', async () => {
    const a = await get('home/dashboard', `division=wsl&season=${tag}-a`);
    expect(a.body.data.topScorer).toMatchObject({ name: `${tag} Traveller`, stat: 2 });
    const b = await get('home/dashboard', `division=freshers&season=${tag}-b`);
    expect(b.body.data.topScorer).toMatchObject({ name: `${tag} Traveller`, stat: 1 });
  });

  it('the player page has one line per season and a career line that adds them up', async () => {
    const { status, body } = await playerPage();
    expect(status).toBe(200);
    const lines = body.data.seasons.map((s: any) => ({ season: s.season.slug, division: s.division.slug, team: s.team?.name, goals: s.goals, assists: s.assists }));
    expect(lines).toEqual([
      { season: `${tag}-b`, division: 'freshers', team: `${tag} Gamma`, goals: 1, assists: 0 },
      { season: `${tag}-a`, division: 'wsl', team: `${tag} Alpha`, goals: 2, assists: 1 },
    ]);
    expect(body.data.career).toEqual({ seasons: 2, goals: 3, assists: 1 });
    // The card shows one season's figures: the most recent by default, or the one asked for.
    expect(body.data).toMatchObject({ goals: 1, assists: 0, team: `${tag} Gamma`, jersey_number: 10 });
    const a = await playerPage(`season_id=${made.seasons[0]}`);
    expect(a.body.data).toMatchObject({ goals: 2, assists: 1, team: `${tag} Alpha`, jersey_number: 9, position: 'ST' });
    expect(a.body.data).not.toHaveProperty('email');
  });

  it('an unknown or malformed player id is not found', async () => {
    const { GET } = await route('players/[player_id]');
    for (const id of ['not-a-uuid', '00000000-0000-4000-8000-000000000000']) {
      const res: Response = await GET(new Request(`http://localhost/api/players/${id}`), { params: Promise.resolve({ player_id: id }) });
      expect(res.status).toBe(404);
    }
  });

  it('legends equal the sum of each player\'s season lines', async () => {
    const legends = await get('legends');
    expect(legends.body.data.length).toBeGreaterThan(0);
    for (const legend of legends.body.data) {
      const { data: lines } = await admin.from('season_player_stats').select('goals, assists').eq('player_id', legend.id);
      expect(legend.goalsScored).toBe((lines ?? []).reduce((n, l) => n + l.goals, 0));
      expect(legend.assists).toBe((lines ?? []).reduce((n, l) => n + l.assists, 0));
    }
  });
});

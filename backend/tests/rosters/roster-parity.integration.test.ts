// Group: rosters. Parity for the seeded 2026 seasons after the move to player identities and season rosters: every
// page reads the same people and the same numbers. For each division, the season roster lists each player once
// (one per roster place), the statistics leaderboard and the home dashboard agree with season_player_stats (the
// single source), and the live-scoring player list is the season roster. Local Supabase stack only.
import { beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clients, localKeys } from '../auth/local-supabase';


let admin: SupabaseClient;
const get = async (name: string, query = '') => {
  const { GET } = await import(`../../app/api/${name}/route`);
  const res: Response = await GET(new Request(`http://localhost/api/${name}?${query}`));
  return { status: res.status, body: await res.json() };
};
const currentSeason = async (division: string) => {
  const d = (await admin.from('divisions').select('id').eq('slug', division).single()).data!;
  return (await admin.from('seasons').select('id').eq('division_id', d.id).eq('is_current', true).single()).data!.id as string;
};

beforeAll(() => {
  const keys = localKeys();
  process.env.SUPABASE_URL = keys.url;
  process.env.SUPABASE_PUBLISHABLE_KEY = keys.publishable;
  process.env.SUPABASE_SECRET_KEY = keys.secret;
  admin = clients(keys).admin;
});

describe.each(['super-league', 'wsl', 'freshers'])('the 2026 %s season', (division) => {
  it('the season roster lists every roster place once, with no duplicate people', async () => {
    const season = await currentSeason(division);
    const { status, body } = await get('players', `division=${division}`);
    expect(status).toBe(200);
    const { count } = await admin.from('roster_memberships').select('id', { count: 'exact', head: true }).eq('season_id', season);
    expect(body.data).toHaveLength(count!);
    expect(new Set(body.data.map((p: any) => p.id)).size).toBe(count);
    expect(body.data.every((p: any) => p.team && p.membership_id)).toBe(true);
  });

  it('the leaderboard, home dashboard and season roster show the numbers of season_player_stats', async () => {
    const season = await currentSeason(division);
    const { data: lines } = await admin.from('season_player_stats').select('player_id, goals, assists').eq('season_id', season);
    const byPlayer = new Map((lines ?? []).map((l) => [l.player_id, l]));
    const best = Math.max(0, ...(lines ?? []).map((l) => l.goals));

    const board = await get('leaderboard', `division=${division}`);
    for (const row of board.body.data.topScorers) expect(row.goalsScored).toBe(byPlayer.get(row.id)?.goals ?? 0);
    if (best > 0) expect(board.body.data.topScorers[0].goalsScored).toBe(best);

    const home = await get('home/dashboard', `division=${division}`);
    if (best > 0) expect(home.body.data.topScorer.stat).toBe(best);

    const roster = await get('players', `division=${division}`);
    for (const p of roster.body.data) {
      expect(p.goals).toBe(byPlayer.get(p.id)?.goals ?? 0);
      expect(p.assists).toBe(byPlayer.get(p.id)?.assists ?? 0);
    }
  });
});

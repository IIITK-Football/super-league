// Group: api-services. D-04 allows at most three sequential Data API rounds per route. The home dashboard (the
// heaviest public read) and scope resolution are counted through the Worker's Server-Timing accounting against a
// stubbed Data API, so the count is exact and needs no database.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { resolveScope, ScopeError } from '../../backend/lib/scope';
import { publicClient, withTiming } from '../../backend/lib/supabase/clients';

const DIVISION = { id: 'd1', slug: 'super-league', name: 'Super League' };
const SEASON = { id: 's1', slug: '2026', name: '2026', is_current: true, format: 'league' };

// A minimal PostgREST stand-in: answers by table, with a short delay so overlapping calls really overlap.
function stubDataApi(tables: Record<string, unknown[]>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const table = url.pathname.replace(/^\/rest\/v1\/(rpc\/)?/, '');
    const rows = tables[table] ?? [];
    await new Promise((r) => setTimeout(r, 5));
    const accept = new Headers(init?.headers).get('Accept') ?? '';
    const body = accept.includes('vnd.pgrst.object') ? (rows[0] ?? null) : rows;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}

beforeEach(() => {
  Object.assign(process.env, { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SL_ENVIRONMENT: 'local' });
});
afterEach(() => vi.restoreAllMocks());

const rounds = (header: string | null) => Number(/rounds=(\d+)/.exec(header ?? '')?.[1]);

describe('sequential Data API rounds (D-04)', () => {
  it('resolves a scope in one round, and only a miss reads again to explain it', async () => {
    stubDataApi({ seasons: [{ ...SEASON, division: DIVISION }] });
    const hit = withTiming(() => resolveScope(publicClient(), { division: 'super-league' }));
    expect(await hit.result).toEqual({ division: DIVISION, season: SEASON });
    expect(hit.timing.rounds).toBe(1);

    vi.restoreAllMocks();
    stubDataApi({ seasons: [], divisions: [{ name: 'Super League' }] });
    const miss = withTiming(() => resolveScope(publicClient(), { division: 'super-league', season: '1999' }));
    await expect(miss.result).rejects.toEqual(new ScopeError(404, 'Season "1999" not found in Super League'));
    expect(miss.timing.rounds).toBe(2);
  });

  it('serves the home dashboard in at most three rounds and reports them in Server-Timing', async () => {
    stubDataApi({
      seasons: [{ ...SEASON, division: DIVISION, section_flags: { overview: true } }],
      team_entries: [{ team: { id: 't1', name: 'Alpha', logo_url: null } }, { team: { id: 't2', name: 'Beta', logo_url: null } }],
      matches: [{ id: 'm1', home_team_id: 't1', away_team_id: 't2', home_score: 2, away_score: 1, status: 'completed', date: '2026-01-01', minute: null, home: { name: 'Alpha' }, away: { name: 'Beta' }, match_events: [] }],
      season_fantasy_leaderboard: [{ user_id: 'u1', points: 7 }],
      user_profiles: [{ id: 'u1', nickname: 'Ace' }],
      division_flairs: [{ user_id: 'u1', team_name: 'Alpha' }],
    });
    const res = await createApp().request('http://localhost/api/home/dashboard?division=super-league');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.standings.map((t: { teamName: string }) => t.teamName)).toEqual(['Alpha', 'Beta']);
    expect(body.data.fantasyTop).toEqual([{ id: 'u1', name: 'Ace', points: 7, flair: 'Alpha' }]);
    expect(body.data.scope).toEqual({ division: DIVISION, season: SEASON });

    const timing = res.headers.get('Server-Timing');
    expect(timing).toMatch(/^total;dur=[\d.]+, db;dur=[\d.]+;desc="rounds=\d+ calls=\d+"$/);
    expect(rounds(timing)).toBeLessThanOrEqual(3);
    expect(timing).not.toMatch(/sb_|Bearer|select|rest\/v1/);
  });
});

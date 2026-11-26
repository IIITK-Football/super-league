// The home dashboard must fail loudly when a query fails: an error is a 500, never an empty standings table or blank tiles.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, reset } from './fake-supabase';

vi.hoisted(() => {
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable';
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
});
vi.mock('@supabase/supabase-js', async () => (await import('./fake-supabase')).supabaseModule);

import { GET } from '../../app/api/home/dashboard/route';

const DIVISION = { id: 'd1', slug: 'super-league', name: 'Super League' };
const SEASON = { id: 's1', slug: '2026', name: '2026', is_current: true, format: 'league' };
const call = () => GET(new Request('http://localhost/api/home/dashboard'));

const healthy = () => {
  db.tables.divisions = { data: DIVISION, error: null };
  db.tables.seasons = { data: SEASON, error: null };
  db.tables.team_entries = { data: [], error: null };
  db.tables.newsletter = { data: [], error: null };
  db.tables.season_player_stats = { data: [], error: null };
  db.tables.matches = { data: [], error: null };
  db.rpc.season_fantasy_leaderboard = { data: [], error: null };
};

beforeEach(() => {
  reset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/home/dashboard', () => {
  it('returns the dashboard when every query succeeds', async () => {
    healthy();
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('answers 500 when the teams query fails, not an empty standings table', async () => {
    healthy();
    db.tables.team_entries = { data: [{ team_id: 't1' }], error: null };
    db.tables.teams = { data: null, error: { message: 'permission denied for table teams' } };
    const res = await call();
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
  });

  it('answers 500 when the news query fails instead of blank tiles', async () => {
    healthy();
    db.tables.newsletter = { data: null, error: { message: 'boom' } };
    expect((await call()).status).toBe(500);
  });

  it('answers 500 when the fantasy leaderboard RPC fails', async () => {
    healthy();
    db.rpc.season_fantasy_leaderboard = { data: null, error: { message: 'boom' } };
    expect((await call()).status).toBe(500);
  });
});

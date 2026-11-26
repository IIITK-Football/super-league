// The match list for scoring: the caller is signed in before anything is read, and a failed role check fails closed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, reset } from './fake-supabase';

vi.hoisted(() => {
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable';
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
});
vi.mock('@supabase/ssr', async () => (await import('./fake-supabase')).ssrModule);

import { GET } from '../../app/api/admin/matches/route';

const DIVISION = { id: 'd1', slug: 'super-league', name: 'Super League' };
const SEASON = { id: 's1', slug: '2026', name: '2026', is_current: true, format: 'league' };
const MATCH = { id: 'm1', home_team_id: 't1', away_team_id: 't2', status: 'scheduled', home: { id: 't1', name: 'A' }, away: { id: 't2', name: 'B' } };
const call = () => GET(new Request('http://localhost/api/admin/matches?division=super-league', { headers: { Authorization: 'Bearer t' } }));
const matchReads = () => db.calls.filter((c) => c.target === 'matches' && c.method === 'select');

beforeEach(() => {
  reset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  db.tables.divisions = { data: DIVISION, error: null };
  db.tables.seasons = { data: SEASON, error: null };
  db.tables.matches = { data: [MATCH], error: null };
  db.rpc.is_dictator = { data: true, error: null };
  db.rpc.matches_needing_regrade = { data: [], error: null };
});

describe('GET /api/admin/matches', () => {
  it('reads no matches for a caller who is not signed in', async () => {
    const res = await call();
    expect(res.status).toBe(401);
    expect(matchReads()).toEqual([]);
  });

  it('answers 500 and lists nothing when the dictator check fails', async () => {
    db.user = { id: 'someone' };
    db.rpc.is_dictator = { data: null, error: { message: 'function is_dictator() does not exist' } };
    const res = await call();
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
  });

  it('lists the season matches to a dictator', async () => {
    db.user = { id: 'dictator' };
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(1);
  });
});

describe('GET /api/admin/matches fields', () => {
  it('selects the date, venue and clock fields the dashboard needs to edit and resume a match', async () => {
    db.user = { id: 'dictator' };
    await call();
    const select = db.calls.find((c) => c.target === 'matches' && c.method === 'select')!.args[0] as string;
    for (const field of ['date', 'venue', 'timer_start_time', 'timer_calibration', 'minute']) {
      expect(select).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });
});

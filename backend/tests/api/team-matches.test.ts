// Team fixtures carry live scores, so the route is never cached, and team_id is checked before it reaches a filter.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, reset } from './fake-supabase';

vi.hoisted(() => {
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable';
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
});
vi.mock('@supabase/supabase-js', async () => (await import('./fake-supabase')).supabaseModule);

import { GET, revalidate } from '../../app/api/teams/[team_id]/matches/route';

const TEAM = '3f2c1a4e-8b7d-4c6e-9a1f-0d2e3c4b5a69';
const call = (teamId: string) => GET(new Request('http://localhost/api/teams/x/matches'), { params: Promise.resolve({ team_id: teamId }) });

beforeEach(() => {
  reset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/teams/:team_id/matches', () => {
  it('is not cached, so live scores are current', () => {
    expect(revalidate).toBe(0);
  });

  it('rejects a team_id that is not a UUID without querying', async () => {
    // A query that would fail: a 400 proves the id was refused before any query ran.
    db.tables.matches = { data: null, error: { message: 'query ran' } };
    const res = await call('x,status.eq.completed');
    expect(res.status).toBe(400);
    expect((await res.json()).success).toBe(false);
  });

  it('returns the team fixtures for a valid UUID', async () => {
    db.tables.matches = { data: [{ id: 'm1', date: '2026-12-01', status: 'scheduled', season: { section_flags: { teams: true } }, home_score: null, away_score: null, venue: null, home_team: { id: TEAM, name: 'A' }, away_team: { id: 'b', name: 'B' } }], error: null };
    const res = await call(TEAM);
    expect(res.status).toBe(200);
    expect((await res.json()).data[0]).toMatchObject({ id: 'm1', home_team: 'A', away_team: 'B' });
  });
});

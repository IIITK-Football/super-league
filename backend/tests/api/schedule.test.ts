// The schedule lists open matches (scheduled or live) and never asks the database for a zero or negative page.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, reset } from './fake-supabase';

vi.hoisted(() => {
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable';
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
});
vi.mock('@supabase/ssr', async () => (await import('./fake-supabase')).ssrModule);

import { GET } from '../../app/api/schedule/route';
import { OPEN_STATUSES } from '../../lib/matchStatus';

const DIVISION = { id: 'd1', slug: 'super-league', name: 'Super League' };
const SEASON = { id: 's1', slug: '2026', name: '2026', is_current: true, format: 'league', division: DIVISION, section_flags: { overview: true, fixtures: true, teams: true } };
const call = (query = '') => GET(new Request(`http://localhost/api/schedule${query}`));
const matchCalls = (method: string) => db.calls.filter((c) => c.target === 'matches' && c.method === method);

beforeEach(() => {
  reset();
  db.tables.divisions = { data: DIVISION, error: null };
  db.tables.seasons = { data: SEASON, error: null };
  db.tables.matches = { data: [], error: null, count: 0 };
});

describe('GET /api/schedule', () => {
  it('lists scheduled and live matches, the same statuses the dashboard treats as open', async () => {
    expect((await call()).status).toBe(200);
    expect(OPEN_STATUSES).toEqual(['scheduled', 'live']);
    expect(matchCalls('in')[0].args).toEqual(['status', ['scheduled', 'live']]);
  });

  it('asks for the first page of ten when the paging is missing', async () => {
    await call();
    expect(matchCalls('range')[0].args).toEqual([0, 9]);
  });

  it('never asks for a negative range when page or limit is zero', async () => {
    await call('?page=0&limit=0');
    expect(matchCalls('range')[0].args).toEqual([0, 9]);
  });
});

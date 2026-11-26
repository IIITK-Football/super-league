// Live scoring: a goal moves a scheduled match to live, and a failed status write is reported, not swallowed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, reset } from './fake-supabase';

vi.hoisted(() => {
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable';
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
});
vi.mock('@supabase/ssr', async () => (await import('./fake-supabase')).ssrModule);

import { POST } from '../../app/api/admin/matches/live/route';

const MATCH = 'b1a2c3d4-0000-4000-8000-000000000001';
const HOME = 'a1000000-0000-4000-8000-000000000001';
const AWAY = 'a1000000-0000-4000-8000-000000000002';
const PLAYER = 'c1000000-0000-4000-8000-000000000001';
const EVENT = 'e1000000-0000-4000-8000-000000000001';

const send = (body: unknown) => POST(new Request('http://localhost/api/admin/matches/live', {
  method: 'POST',
  headers: { Authorization: 'Bearer t' },
  body: JSON.stringify(body),
}));
const goal = { match_id: MATCH, action: 'add_event', event: { id: EVENT, kind: 'goal', team_id: HOME, player_id: PLAYER, minute: '10' } };

beforeEach(() => {
  reset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  db.user = { id: 'scorer' };
  db.rpc.can_score = { data: true, error: null };
  db.tables.matches = { data: { id: MATCH, home_team_id: HOME, away_team_id: AWAY, home_score: 0, away_score: 0, status: 'scheduled', minute: null, events_version: 0, result_kind: null }, error: null };
  db.tables.match_events = { data: null, error: null }; // no existing event: the goal is new
});

describe('POST /api/admin/matches/live', () => {
  it('moves a scheduled match to live when a goal is recorded', async () => {
    const res = await send(goal);
    expect(res.status).toBe(200);
    expect(db.calls.some((c) => c.target === 'matches' && c.method === 'update' && (c.args[0] as { status?: string }).status === 'live')).toBe(true);
  });

  it('reports a failed status update instead of answering success', async () => {
    db.tables['matches.update'] = { data: null, error: { message: 'could not update matches' } };
    const res = await send(goal);
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
  });
});

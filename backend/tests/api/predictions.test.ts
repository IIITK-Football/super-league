// A prediction is saved only while its match is scheduled and before kickoff, with whole-number scores.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, reset } from './fake-supabase';

vi.hoisted(() => {
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable';
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
});
vi.mock('@supabase/ssr', async () => (await import('./fake-supabase')).ssrModule);

import { POST } from '../../app/api/predictions/[match_id]/route';

const MATCH = 'b1a2c3d4-0000-4000-8000-000000000001';
const HOUR = 60 * 60 * 1000;
const future = () => new Date(Date.now() + HOUR).toISOString();
const past = () => new Date(Date.now() - HOUR).toISOString();

const submit = (body: unknown) => POST(
  new Request(`http://localhost/api/predictions/${MATCH}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer t' },
    body: JSON.stringify(body),
  }),
  { params: Promise.resolve({ match_id: MATCH }) },
);
const valid = { predicted_home_score: 2, predicted_away_score: 1 };

beforeEach(() => {
  reset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  db.user = { id: 'u1' };
  db.tables.predictions = { data: null, error: null };
  db.tables.matches = { data: { status: 'scheduled', date: future() }, error: null };
});

describe('POST /api/predictions/:match_id', () => {
  it('saves a prediction for a scheduled match before kickoff', async () => {
    const res = await submit(valid);
    expect(res.status).toBe(200);
    expect(db.inserts).toHaveLength(1);
  });

  it('refuses a prediction once kickoff has passed', async () => {
    db.tables.matches = { data: { status: 'scheduled', date: past() }, error: null };
    const res = await submit(valid);
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe('Predictions are closed for this match.');
    expect(db.inserts).toEqual([]);
  });

  it('refuses a prediction for a match that is live or final', async () => {
    for (const status of ['live', 'completed', 'forfeited']) {
      db.tables.matches = { data: { status, date: future() }, error: null };
      expect((await submit(valid)).status).toBe(400);
    }
    expect(db.inserts).toEqual([]);
  });

  it('refuses negative, fractional or missing scores', async () => {
    for (const body of [
      { predicted_home_score: -1, predicted_away_score: 0 },
      { predicted_home_score: 1.5, predicted_away_score: 0 },
      { predicted_away_score: 0 },
    ]) {
      expect((await submit(body)).status).toBe(400);
    }
    expect(db.inserts).toEqual([]);
  });

  it('answers 404 for an unknown match', async () => {
    db.tables.matches = { data: null, error: null };
    expect((await submit(valid)).status).toBe(404);
  });
});

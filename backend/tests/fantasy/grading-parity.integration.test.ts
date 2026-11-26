// Group: fantasy. Grading runs in the database (prediction_points, used by grade_match) while the history breakdown is
// computed by lib/grading.ts. Both must give the same points for every prediction, so they are compared over a spread of
// scorelines, repeated and unknown players, non-array predictions and own-goal-free attributions.
import { describe, expect, it } from 'vitest';
import { clients, localKeys } from '../auth/local-supabase';
import { actualPlayers, predictionPoints } from '../../lib/grading';

const admin = clients(localKeys()).admin;
const P = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];

function cases() {
  const out: { pred: [number, number, unknown, unknown]; actual: [number, number]; events: { kind: string; player_id: string | null; assist_player_id: string | null; voided_at: string | null }[] }[] = [];
  let seed = 7;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const pick = () => Array.from({ length: rnd(4) }, () => P[rnd(3)]);
  for (let i = 0; i < 60; i += 1) {
    const events = Array.from({ length: rnd(5) }, () => ({
      kind: rnd(5) === 0 ? 'own_goal' : 'goal',
      player_id: rnd(4) === 0 ? null : P[rnd(3)],
      assist_player_id: rnd(2) === 0 ? null : P[rnd(3)],
      voided_at: rnd(6) === 0 ? '2026-01-01T00:00:00Z' : null,
    }));
    const odd = rnd(10);
    out.push({
      pred: [rnd(4), rnd(4), odd === 0 ? null : odd === 1 ? 'x' : pick(), odd === 2 ? {} : pick()],
      actual: [rnd(4), rnd(4)],
      events,
    });
  }
  return out;
}

describe('database and breakdown grading agree', () => {
  it('prediction_points equals predictionPoints for every case', async () => {
    for (const c of cases()) {
      const actual = actualPlayers(c.events);
      const expected = predictionPoints(
        { predicted_home_score: c.pred[0], predicted_away_score: c.pred[1], predicted_scorers: c.pred[2] as string[], predicted_assists: c.pred[3] as string[] },
        { home_score: c.actual[0], away_score: c.actual[1] },
        actual,
      );
      const { data, error } = await admin.rpc('prediction_points', {
        p_pred_home: c.pred[0], p_pred_away: c.pred[1], p_scorers: c.pred[2], p_assists: c.pred[3],
        p_home: c.actual[0], p_away: c.actual[1], p_actual_scorers: actual.scorers, p_actual_assists: actual.assists,
      });
      expect(error).toBeNull();
      expect(data, JSON.stringify(c)).toBe(expected);
    }
  });
});

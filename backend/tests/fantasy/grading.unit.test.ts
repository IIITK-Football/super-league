// Group: fantasy. One points function serves grading, regrading and the history: the scoreline from the cached score,
// player points from attributed goal events and their assisters. Unattributed and voided goals count toward the
// scoreline only; repeating the calculation gives the same points.
import { describe, expect, it } from 'vitest';
import { actualPlayers, playerHits, predictionPoints, scorelinePoints } from '@/lib/grading';

describe('scorelinePoints', () => {
  it('exact score 300; right result 100 minus 10 per goal off; wrong result only the penalty', () => {
    expect(scorelinePoints(2, 1, 2, 1)).toBe(300);
    expect(scorelinePoints(2, 0, 3, 0)).toBe(100 - 10);
    expect(scorelinePoints(1, 1, 0, 0)).toBe(100 - 20);
    expect(scorelinePoints(0, 2, 1, 0)).toBe(0 - 30);
  });
});

describe('actualPlayers', () => {
  it('lists one scorer per attributed goal and the assisters; own goals, cards, unattributed and voided goals add no scorer', () => {
    const events = [
      { kind: 'goal', player_id: 'p1', assist_player_id: 'p2' },
      { kind: 'goal', player_id: 'p1', assist_player_id: null },
      { kind: 'goal', player_id: null, assist_player_id: null },
      { kind: 'goal', player_id: 'p3', assist_player_id: 'p4', voided_at: '2026-01-01' },
      { kind: 'own_goal', player_id: 'p5', assist_player_id: null },
      { kind: 'yellow', player_id: 'p6', assist_player_id: null },
    ];
    expect(actualPlayers(events)).toEqual({ scorers: ['p1', 'p1'], assists: ['p2'] });
  });
});

describe('playerHits and predictionPoints', () => {
  it('counts the lower of predicted and actual per player', () => {
    expect(playerHits(['a', 'a', 'b'], ['a', 'c'])).toBe(1);
    expect(playerHits(null, ['a'])).toBe(0);
  });
  it('adds 100 per scorer hit and 50 per assist hit to the scoreline, and is repeatable', () => {
    const prediction = { predicted_home_score: 2, predicted_away_score: 0, predicted_scorers: ['p1', 'p2'], predicted_assists: ['p3'] };
    const actual = { scorers: ['p1', 'p1'], assists: ['p3'] };
    const first = predictionPoints(prediction, { home_score: 2, away_score: 0 }, actual);
    expect(first).toBe(300 + 100 + 50);
    expect(predictionPoints(prediction, { home_score: 2, away_score: 0 }, actual)).toBe(first);
  });
  it('a corrected attribution changes only the player points', () => {
    const prediction = { predicted_home_score: 1, predicted_away_score: 0, predicted_scorers: ['p1'], predicted_assists: [] };
    const before = predictionPoints(prediction, { home_score: 1, away_score: 0 }, { scorers: [], assists: [] });
    const after = predictionPoints(prediction, { home_score: 1, away_score: 0 }, { scorers: ['p1'], assists: [] });
    expect(after - before).toBe(100);
  });
});

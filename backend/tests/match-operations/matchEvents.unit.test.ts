// Group: match-operations. The pure helpers of the live scoring route: minutes, event validation and the "+1" / "-1"
// score-step planner (D-08): +1 adds an unattributed goal, -1 voids the newest unattributed goal for that side, and
// when every goal has a scorer nothing is removed silently: the scorer chooses.
import { describe, expect, it } from 'vitest';
import { parseEventInput, parseMinute, planScoreStep, type EventRow } from '@/lib/matchEvents';

const match = { home_team_id: 'h', away_team_id: 'a' };
const ID = '11111111-1111-4111-8111-111111111111';
const P1 = '22222222-2222-4222-8222-222222222222';
const P2 = '33333333-3333-4333-8333-333333333333';

describe('parseMinute', () => {
  it('reads plain, apostrophe and added minutes, and treats anything else as unknown', () => {
    expect(parseMinute(45)).toEqual({ minute: 45, added: null });
    expect(parseMinute("45'")).toEqual({ minute: 45, added: null });
    expect(parseMinute('45+2')).toEqual({ minute: 45, added: 2 });
    expect(parseMinute('')).toEqual({ minute: null, added: null });
    expect(parseMinute('HT')).toEqual({ minute: null, added: null });
    expect(parseMinute(200)).toEqual({ minute: null, added: null });
  });
});

describe('parseEventInput', () => {
  it('accepts a goal with no scorer yet (an unattributed goal) and keeps the given id', () => {
    const r = parseEventInput({ id: ID, kind: 'goal', team_id: 'h' }, match);
    expect(r).toEqual({ ok: true, event: { id: ID, kind: 'goal', team_id: 'h' } });
  });
  it('rejects a team that is not playing, an unknown kind, a card without a player and an assister who is the scorer', () => {
    expect(parseEventInput({ kind: 'goal', team_id: 'x' }, match)).toMatchObject({ ok: false, message: /not playing/ });
    expect(parseEventInput({ kind: 'penalty', team_id: 'h' }, match)).toMatchObject({ ok: false });
    expect(parseEventInput({ kind: 'yellow', team_id: 'h' }, match)).toMatchObject({ ok: false, message: /needs a player/ });
    expect(parseEventInput({ kind: 'goal', team_id: 'h', player_id: P1, assist_player_id: P1 }, match)).toMatchObject({ ok: false, message: /cannot be the scorer/ });
    expect(parseEventInput({ kind: 'goal', team_id: 'h', player_id: 'nope' }, match)).toMatchObject({ ok: false });
    expect(parseEventInput({ id: 'bad', kind: 'goal', team_id: 'h' }, match)).toMatchObject({ ok: false, message: /UUID/ });
  });
  it('a partial edit keeps only the fields that were sent', () => {
    const r = parseEventInput({ id: ID, player_id: P1, minute: '12' }, match, { partial: true });
    expect(r).toEqual({ ok: true, event: { id: ID, player_id: P1, minute: 12, added_minute: null } });
  });
});

describe('planScoreStep', () => {
  const goal = (team: string, over: Partial<EventRow & { created_at: string }> = {}) => ({ kind: 'goal', team_id: team, ...over }) as EventRow;
  it('+1 adds an unattributed goal for the side', () => {
    expect(planScoreStep([], match, 'home', 1)).toEqual({ ok: true, action: 'add', team_id: 'h' });
    expect(planScoreStep([], match, 'away', 1)).toEqual({ ok: true, action: 'add', team_id: 'a' });
  });
  it('-1 voids the newest unattributed goal of that side', () => {
    const events = [
      goal('h', { id: 'old', created_at: '2026-01-01T10:00:00Z' } as any),
      goal('h', { id: 'new', created_at: '2026-01-01T10:05:00Z' } as any),
      goal('h', { id: 'named', player_id: P1, created_at: '2026-01-01T10:09:00Z' } as any),
      goal('a', { id: 'other' }),
    ];
    expect(planScoreStep(events, match, 'home', -1)).toEqual({ ok: true, action: 'void', event_id: 'new' });
  });
  it('-1 with every goal attributed lets the scorer choose, listing the goals that count for the side (own goals included)', () => {
    const events = [goal('h', { id: 'g1', player_id: P1 }), { kind: 'own_goal', team_id: 'a', id: 'og', player_id: P2 } as EventRow, goal('a', { id: 'away', player_id: P2 })];
    const plan = planScoreStep(events, match, 'home', -1);
    expect(plan).toMatchObject({ ok: true, action: 'choose' });
    expect((plan as any).candidates.map((e: EventRow) => e.id).sort()).toEqual(['g1', 'og']);
  });
  it('-1 with nothing to remove, a bad side or a bad delta is refused; voided goals never count', () => {
    expect(planScoreStep([], match, 'home', -1)).toMatchObject({ ok: false });
    expect(planScoreStep([goal('h', { voided_at: 'x' })], match, 'home', -1)).toMatchObject({ ok: false });
    expect(planScoreStep([], match, 'middle', 1)).toMatchObject({ ok: false });
    expect(planScoreStep([], match, 'home', 2)).toMatchObject({ ok: false });
  });
});

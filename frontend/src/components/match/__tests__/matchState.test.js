// Group: frontend-components. The division home picks one match to open first, and lists group by day.
import { describe, expect, it } from 'vitest';
import { groupByDate, pickHeroMatch } from '../matchState';

const m = (id, status, date) => ({ id, status, date });
const now = Date.parse('2026-11-26T12:00:00Z');

describe('pickHeroMatch', () => {
  it('opens on a live match ahead of anything else', () => {
    const hero = pickHeroMatch([m('a', 'scheduled', '2026-11-27T10:00:00Z'), m('b', 'live', '2026-11-20T10:00:00Z')], now);
    expect(hero).toEqual({ match: m('b', 'live', '2026-11-20T10:00:00Z'), kind: 'live' });
  });

  it('otherwise opens on the next scheduled match', () => {
    const hero = pickHeroMatch([
      m('late', 'scheduled', '2026-12-05T10:00:00Z'),
      m('next', 'scheduled', '2026-11-28T10:00:00Z'),
      m('done', 'completed', '2026-11-20T10:00:00Z'),
    ], now);
    expect(hero.match.id).toBe('next');
    expect(hero.kind).toBe('next');
  });

  it('otherwise opens on the latest result, forfeits included', () => {
    const hero = pickHeroMatch([
      m('old', 'completed', '2026-11-01T10:00:00Z'),
      m('forfeit', 'forfeited', '2026-11-20T10:00:00Z'),
    ], now);
    expect(hero).toEqual({ match: m('forfeit', 'forfeited', '2026-11-20T10:00:00Z'), kind: 'result' });
  });

  it('returns null when there is no match', () => {
    expect(pickHeroMatch([], now)).toBeNull();
  });
});

describe('groupByDate', () => {
  it('groups matches by local day, keeps their order, and puts undated matches last', () => {
    const groups = groupByDate([
      m('a', 'scheduled', '2026-11-28T10:00:00'),
      m('b', 'scheduled', '2026-11-28T15:00:00'),
      m('x', 'scheduled', null),
      m('c', 'scheduled', '2026-11-29T10:00:00'),
    ]);
    expect(groups.map((g) => g.matches.map((x) => x.id))).toEqual([['a', 'b'], ['c'], ['x']]);
    expect(groups[2].date).toBeNull();
  });
});

// Group: frontend-components. The canonical FUT card attributes: older rows convert into the canonical shape without
// losing anything (what cannot convert is kept under legacy), conversion is idempotent, an unedited save round-trips,
// saving applies only the form's fields and keeps every other value, and nothing is invented.
import { describe, expect, it } from 'vitest';
import { applyCardDraft, blankCardDraft, canonicalAttributes, cardDraft, statValue } from '../playerCard';

const canonical = {
  stats: { Pace: { total: 81, sprint: 80 }, Shooting: { total: 70 } },
  bio: { preferredFoot: 'Left', height: 180 },
  playStyle: 'Power Shot',
  custom: { keep: true },
};

describe('reading the card', () => {
  it('reads the card shape and falls back to older flat numbers', () => {
    expect(cardDraft(canonical)).toEqual({
      stats: { Pace: '81', Shooting: '70', Passing: '', Dribbling: '', Defending: '', Physicality: '' },
      preferredFoot: 'Left',
      playStyle: 'Power Shot',
    });
    expect(statValue({ pace: 59, passing: 57 }, 'Pace')).toBe(59);
    expect(cardDraft({ pace: 59 }).stats.Pace).toBe('59');
  });

  it('invents nothing for an empty card', () => {
    expect(cardDraft(null)).toEqual(blankCardDraft());
    expect(blankCardDraft()).toEqual({ stats: { Pace: '', Shooting: '', Passing: '', Dribbling: '', Defending: '', Physicality: '' }, preferredFoot: '', playStyle: '' });
    expect(applyCardDraft({}, blankCardDraft()).value).toEqual({});
  });
});

describe('saving the card', () => {
  it('applies the form and keeps every value it does not show', () => {
    const draft = cardDraft(canonical);
    draft.stats.Pace = '84';
    draft.stats.Defending = '40';
    draft.preferredFoot = 'Both';
    const { value } = applyCardDraft(canonical, draft);
    expect(value).toEqual({
      stats: { Pace: { total: 84, sprint: 80 }, Shooting: { total: 70 }, Defending: { total: 40 } },
      bio: { preferredFoot: 'Both', height: 180 },
      playStyle: 'Power Shot',
      custom: { keep: true },
    });
  });

  it('clears a stat the dictator empties', () => {
    const draft = cardDraft({ stats: { Pace: { total: 60 }, Passing: { total: 57 } } });
    draft.stats.Pace = '';
    expect(applyCardDraft({ stats: { Pace: { total: 60 }, Passing: { total: 57 } } }, draft).value).toEqual({ stats: { Passing: { total: 57 } } });
  });

  it('refuses an out-of-range or fractional stat', () => {
    const draft = blankCardDraft();
    draft.stats.Pace = '100';
    expect(applyCardDraft({}, draft).error).toMatch(/Pace must be a whole number between 1 and 99/);
    draft.stats.Pace = '7.5';
    expect(applyCardDraft({}, draft).error).toMatch(/Pace/);
  });
});

describe('converting older attributes to the canonical shape', () => {
  it('moves flat numbers into stats', () => {
    expect(canonicalAttributes({ pace: 59, passing: 57, shooting: 63 })).toEqual({ stats: { Pace: { total: 59 }, Passing: { total: 57 }, Shooting: { total: 63 } } });
  });

  it('keeps under legacy whatever cannot take its canonical place, dropping nothing', () => {
    expect(canonicalAttributes({
      pace: 59, stats: { Pace: { total: 60 }, Speed: { total: 1 }, Passing: { total: 120 } }, shooting: 'high',
      bio: { preferredFoot: 'left', height: 170 }, other: [1],
    })).toEqual({
      stats: { Pace: { total: 60 } },
      bio: { preferredFoot: 'Left', height: 170 },
      other: [1],
      legacy: { pace: 59, shooting: 'high', stats_Speed: { total: 1 }, stats_Passing: { total: 120 } },
    });
    expect(canonicalAttributes({ bio: { preferredFoot: 'sideways' } })).toEqual({ bio: {}, legacy: { preferredFoot: 'sideways' } });
    expect(canonicalAttributes([1, 2])).toEqual({ legacy: { attributes: [1, 2] } });
  });

  it('is idempotent, and an unedited save round-trips every value', () => {
    for (const stored of [
      { pace: 59, passing: 57 },
      { stats: { Pace: { total: 81, sprint: 80 } }, bio: { preferredFoot: 'Both', height: 1 }, playStyle: 'Power Shot', x: { y: 1 } },
      { pace: 59, stats: { Pace: { total: 60 } }, legacy: { earlier: true } },
      {},
    ]) {
      const once = canonicalAttributes(stored);
      expect(canonicalAttributes(once)).toEqual(once);
      expect(applyCardDraft(stored, cardDraft(stored)).value).toEqual(once);
    }
  });
});

// Group: frontend-components. Events sort by minute, then added time, so 45+2 comes before 46.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: { auth: {}, from: () => ({}) } }));

import { sortEvents } from '../MatchTimeline';

describe('sortEvents', () => {
  it('puts added time after its minute and before the next minute', () => {
    const sorted = sortEvents([
      { id: 'a', minute: 46 },
      { id: 'b', minute: 45, added_minute: 2 },
      { id: 'c', minute: 45 },
    ]);
    expect(sorted.map((e) => e.id)).toEqual(['c', 'b', 'a']);
  });
});

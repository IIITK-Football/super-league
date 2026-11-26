// Group: frontend-components. The squad is grouped in squad order, with unassigned players last.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: { auth: {}, from: () => ({}) } }));
import { groupSquad } from '../Teams';

describe('groupSquad', () => {
  it('orders positions and puts unassigned players last', () => {
    const groups = groupSquad([
      { id: 'a', name: 'Zed', position: 'ST' },
      { id: 'b', name: 'Amy', position: 'GK' },
      { id: 'c', name: 'Bo', position: '' },
      { id: 'd', name: 'Cy', position: 'fwd' },
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Goalkeepers', 'ST', 'Forwards', 'Unassigned']);
    expect(groups.at(-1).players.map((p) => p.id)).toEqual(['c']);
    expect(groups[0].players[0].id).toBe('b');
  });

  it('sorts players with a photo first, then by name', () => {
    const [group] = groupSquad([
      { id: 'x', name: 'Beth', position: 'MID' },
      { id: 'y', name: 'Al', position: 'MID' },
      { id: 'z', name: 'Cal', position: 'MID', image_url: 'p.png' },
    ]);
    expect(group.players.map((p) => p.id)).toEqual(['z', 'y', 'x']);
  });
});

// Group: frontend-components. Captains may change only the allow-listed fields of existing players on their roster;
// the arguments never carry a name, email, account link or roster change.
import { describe, expect, it } from 'vitest';
import { rosterPlayerRpcArgs } from '../rosterPlayerUpdate';

const attributes = { stats: { Pace: { total: 70 } }, playStyle: 'Power Shot' };

describe('rosterPlayerRpcArgs', () => {
  it('maps the allow-listed fields onto the roster place', () => {
    expect(
      rosterPlayerRpcArgs({ id: 'm1', position: 'ST', jerseyNumber: '9', overallRating: '80', imageUrl: 'https://img/x.png' }, attributes),
    ).toEqual({
      p_membership_id: 'm1',
      p_position: 'ST',
      p_jersey_number: 9,
      p_overall_rating: 80,
      p_attributes: attributes,
      p_image_url: 'https://img/x.png',
    });
  });

  it('never sends a name, email or other identity field, even when the player object has them', () => {
    const args = rosterPlayerRpcArgs({ id: 'm1', fullName: 'Ada Striker', email: 'someone@iiitkottayam.ac.in', playerId: 'p1', position: 'CM' }, attributes);
    expect(Object.keys(args).sort()).toEqual(['p_attributes', 'p_image_url', 'p_jersey_number', 'p_membership_id', 'p_overall_rating', 'p_position']);
    expect(JSON.stringify(args)).not.toMatch(/someone@|Ada Striker/);
  });

  it('turns empty values into null and never generates a rating', () => {
    expect(rosterPlayerRpcArgs({ id: 'm1', position: '', jerseyNumber: '', overallRating: '', imageUrl: '' }, attributes)).toMatchObject({
      p_position: null,
      p_jersey_number: null,
      p_overall_rating: null,
      p_image_url: null,
    });
    expect(rosterPlayerRpcArgs({ id: 'm1', overallRating: 72 }, attributes).p_overall_rating).toBe(72);
    expect(rosterPlayerRpcArgs({ id: 'm1', jerseyNumber: 0 }, attributes).p_jersey_number).toBe(0); // 0 is a real number
    expect(rosterPlayerRpcArgs({ id: 'm1', jerseyNumber: '0' }, attributes).p_jersey_number).toBe(0);
  });
});

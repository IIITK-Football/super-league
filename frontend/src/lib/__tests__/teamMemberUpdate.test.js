// Group: frontend-components. Captains may change only presentation fields of existing players; the email is a
// protected identity field and is never sent from the team builder.
import { describe, expect, it } from 'vitest';
import { teamMemberRpcArgs } from '../teamMemberUpdate';

const attributes = { stats: { Pace: { total: 70 } }, playStyles: [{ name: 'Finisher' }] };

describe('teamMemberRpcArgs', () => {
  it('maps the approved presentation fields', () => {
    expect(
      teamMemberRpcArgs({ id: 'm1', position: 'ST', jerseyNumber: '9', overallRating: '80', imageUrl: 'https://img/x.png' }, attributes, () => 50),
    ).toEqual({
      p_member_id: 'm1',
      p_position: 'ST',
      p_jersey_number: 9,
      p_overall_rating: 80,
      p_attributes: attributes,
      p_email: null,
      p_image_url: 'https://img/x.png',
    });
  });

  it('never sends an email, even when the player object has one', () => {
    const args = teamMemberRpcArgs({ id: 'm1', email: 'someone@iiitkottayam.ac.in', position: 'CM' }, attributes, () => 50);
    expect(args.p_email).toBeNull();
    expect(JSON.stringify(args)).not.toContain('someone@');
  });

  it('turns empty values into null and falls back to a generated rating only when none is set', () => {
    expect(teamMemberRpcArgs({ id: 'm1', position: '', jerseyNumber: '', overallRating: '', imageUrl: '' }, attributes, () => 61)).toMatchObject({
      p_position: null,
      p_jersey_number: null,
      p_overall_rating: 61,
      p_image_url: null,
    });
    expect(teamMemberRpcArgs({ id: 'm1', overallRating: 72 }, attributes, () => 61).p_overall_rating).toBe(72);
  });
});

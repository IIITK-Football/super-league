// @vitest-environment jsdom
// Group: frontend-components. Access control offers only the agreed roles; the retired legacy admin value is never offered.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const db = {
  user_profiles: [{ id: 'u-new', email: 'new@iiitkottayam.ac.in', real_name: null }],
  user_roles: [],
};
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (table) => {
      const b = { select: () => b, order: () => b, then: (resolve) => resolve({ data: db[table], error: null }) };
      return b;
    },
  },
}));
const { default: ManageRoles } = await import('../ManageRoles');

afterEach(cleanup);

describe('ManageRoles roles', () => {
  it('offers only the agreed roles, never admin', async () => {
    render(<ManageRoles currentUserId="u-me" />);
    const select = await screen.findByLabelText('Role for new@iiitkottayam.ac.in');
    expect(within(select).getAllByRole('option').map((o) => o.value)).toEqual(['default', 'captain', 'editor', 'dictator']);
  });
});

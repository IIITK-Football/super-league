// @vitest-environment jsdom
// Group: frontend-components. Access control never offers the legacy admin role: an account still holding it is shown
// as "Legacy admin (no access)" (not selectable) so a dictator can give it a reviewed role.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const db = {
  user_profiles: [{ id: 'u-old', email: 'old@iiitkottayam.ac.in', real_name: null }, { id: 'u-new', email: 'new@iiitkottayam.ac.in', real_name: null }],
  user_roles: [{ user_id: 'u-old', role: 'admin' }],
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

describe('ManageRoles and the legacy admin role', () => {
  it('never offers admin to assign, and labels an existing legacy admin as having no access', async () => {
    render(<ManageRoles currentUserId="u-me" />);
    const fresh = await screen.findByLabelText('Role for new@iiitkottayam.ac.in');
    const offered = within(fresh).getAllByRole('option').map((o) => o.value);
    expect(offered).toEqual(['default', 'captain', 'editor', 'dictator']);

    const legacy = screen.getByLabelText('Role for old@iiitkottayam.ac.in');
    const legacyOption = within(legacy).getByRole('option', { name: 'Legacy admin (no access)' });
    expect(legacy.value).toBe('admin');
    expect(legacyOption.disabled).toBe(true);
    expect(within(legacy).queryByRole('option', { name: /scorer/i })).toBeNull();
  });
});

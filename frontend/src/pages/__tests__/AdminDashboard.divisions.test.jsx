// @vitest-environment jsdom
// Group: frontend-components. Divisions and seasons is offered to a dictator only. A legacy "admin" value is not a
// role and gets nothing, not even by typing the address; row level security refuses its writes anyway.
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = { roles: ['dictator'] };
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, roles: state.roles, loading: false, rolesError: null, hasRole: (r) => Boolean(state.roles?.includes(r)) }),
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const { mockTools, renderWorkspace } = await import('./workspaceHarness');
mockTools();

afterEach(cleanup);

describe('workspace divisions tool', () => {
  it('is offered to a dictator and opens the divisions panel', async () => {
    state.roles = ['dictator'];
    await renderWorkspace('/dictator');
    fireEvent.click((await screen.findAllByRole('link', { name: /divisions and seasons/i }))[0]);
    expect(await screen.findByText('ManageDivisions panel')).toBeTruthy();
  });

  it('is not offered to a legacy admin or a scorer, even at its address', async () => {
    for (const roles of [['admin'], ['scorer'], []]) {
      state.roles = roles;
      await renderWorkspace('/dictator/divisions');
      expect(await screen.findByText('You do not have access to this workspace')).toBeTruthy();
      expect(screen.queryByText('ManageDivisions panel')).toBeNull();
      cleanup();
    }
  });
});

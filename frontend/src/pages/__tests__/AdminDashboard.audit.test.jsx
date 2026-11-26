// @vitest-environment jsdom
// Group: frontend-components. Audit history is offered to a dictator only; row level security returns the history to
// dictators only anyway.
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

describe('workspace audit tool', () => {
  it('is offered to a dictator and opens the audit panel', async () => {
    state.roles = ['dictator'];
    await renderWorkspace('/dictator/live');
    fireEvent.click((await screen.findAllByRole('link', { name: /audit history/i }))[0]);
    expect(await screen.findByText('AuditHistory panel')).toBeTruthy();
  });

  it('is not offered to a legacy admin, who gets no workspace at all', async () => {
    state.roles = ['admin'];
    await renderWorkspace('/dictator/audit');
    expect(await screen.findByText('You do not have access to this workspace')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /audit history/i })).toBeNull();
    expect(screen.queryByText('LiveController panel')).toBeNull();
  });
});

// @vitest-environment jsdom
// Group: frontend-components. The Audit History tab is offered to a stored dictator only; row level security returns
// the history to dictators only anyway.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = { role: 'dictator' };
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const b = { select: () => b, eq: () => b, in: () => b, maybeSingle: async () => ({ data: state.role ? { role: state.role } : null, error: null }) };
      return b;
    },
  },
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, signOut: vi.fn() }) }));
for (const name of ['ScheduleMatches', 'ManageNews', 'GradePredictions', 'ManageRegistrations', 'ManageRoles', 'ManageDivisions', 'ManageRosters']) {
  vi.doMock(`../../components/admin/${name}`, () => ({ default: () => null }));
}
vi.mock('../../components/admin/LiveController', () => ({ default: () => <p>live panel</p> }));
vi.mock('../../components/admin/AuditHistory', () => ({ default: () => <p>audit panel</p> }));

const { AdminDashboard } = await import('../AdminDashboard');

afterEach(cleanup);

describe('AdminDashboard Audit History tab', () => {
  it('is offered to a dictator and opens the audit panel', async () => {
    state.role = 'dictator';
    render(<AdminDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /audit history/i }));
    expect(await screen.findByText('audit panel')).toBeTruthy();
  });

  it('is not offered to the legacy admin label', async () => {
    state.role = 'admin';
    render(<AdminDashboard />);
    expect(await screen.findByText('live panel')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /audit history/i })).toBeNull();
  });
});

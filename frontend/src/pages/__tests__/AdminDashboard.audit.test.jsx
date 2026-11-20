// @vitest-environment jsdom
// Group: frontend-components. The Audit History tab is offered to a dictator only; row level security returns
// the history to dictators only anyway.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = { roles: ['dictator'] };
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, roles: state.roles, hasRole: (r) => Boolean(state.roles?.includes(r)), signOut: vi.fn() }),
}));
for (const name of ['ScheduleMatches', 'ManageNews', 'GradePredictions', 'ManageCaptains', 'ManageScorers', 'ManageRoles', 'ManageDivisions', 'ManageRosters']) {
  vi.doMock(`../../components/admin/${name}`, () => ({ default: () => null }));
}
vi.mock('../../components/admin/LiveController', () => ({ default: () => <p>live panel</p> }));
vi.mock('../../components/admin/AuditHistory', () => ({ default: () => <p>audit panel</p> }));

const { AdminDashboard } = await import('../AdminDashboard');

afterEach(cleanup);

describe('AdminDashboard Audit History tab', () => {
  it('is offered to a dictator and opens the audit panel', async () => {
    state.roles = ['dictator'];
    render(<AdminDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /audit history/i }));
    expect(await screen.findByText('audit panel')).toBeTruthy();
  });

  it('is not offered to a legacy admin, who gets no dashboard at all', async () => {
    state.roles = ['admin'];
    render(<AdminDashboard />);
    expect(await screen.findByText(/403 forbidden/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /audit history/i })).toBeNull();
    expect(screen.queryByText('live panel')).toBeNull();
  });
});

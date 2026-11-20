// @vitest-environment jsdom
// Group: frontend-components. The Divisions & Seasons tab is offered to a dictator only. A legacy "admin"
// value is not a role and gets nothing; row level security refuses its writes anyway.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = { roles: ['dictator'] };
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, roles: state.roles, hasRole: (r) => Boolean(state.roles?.includes(r)), signOut: vi.fn() }),
}));
vi.mock('../../components/admin/LiveController', () => ({ default: () => <p>live panel</p> }));
vi.mock('../../components/admin/ManageRosters', () => ({ default: () => null }));
vi.mock('../../components/admin/ScheduleMatches', () => ({ default: () => null }));
vi.mock('../../components/admin/ManageNews', () => ({ default: () => null }));
vi.mock('../../components/admin/GradePredictions', () => ({ default: () => null }));
vi.mock('../../components/admin/ManageCaptains', () => ({ default: () => null }));
vi.mock('../../components/admin/ManageScorers', () => ({ default: () => null }));
vi.mock('../../components/admin/ManageRoles', () => ({ default: () => null }));
vi.mock('../../components/admin/ManageDivisions', () => ({ default: () => <p>divisions panel</p> }));
vi.mock('../../components/admin/AuditHistory', () => ({ default: () => null }));

import { AdminDashboard } from '../AdminDashboard';

afterEach(cleanup);

describe('AdminDashboard divisions tab', () => {
  it('is offered to a dictator and opens the divisions panel', async () => {
    state.roles = ['dictator'];
    render(<AdminDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /divisions & seasons/i }));
    expect(await screen.findByText('divisions panel')).toBeTruthy();
  });

  it('is not offered to a legacy admin, who gets no dashboard at all', async () => {
    state.roles = ['admin'];
    render(<AdminDashboard />);
    expect(await screen.findByText(/403 forbidden/i)).toBeTruthy();
    expect(screen.queryByText('live panel')).toBeNull();
    expect(screen.queryByRole('button', { name: /divisions & seasons/i })).toBeNull();
    expect(screen.queryByText('divisions panel')).toBeNull();
  });

  it('keeps everyone else out of the dashboard', async () => {
    state.roles = [];
    render(<AdminDashboard />);
    expect(await screen.findByText(/403 forbidden/i)).toBeTruthy();
  });
});

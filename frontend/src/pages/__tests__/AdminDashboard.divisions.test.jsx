// @vitest-environment jsdom
// Group: frontend-components. The Divisions & Seasons tab is offered to a stored dictator only. A legacy "admin"
// (which the UI may label as dictator) does not get it; row level security refuses its writes anyway.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = { role: 'dictator' };
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const want = {};
      // Like the Data API: only a stored role matching the query's role filter is returned.
      const b = { select: () => b, eq: (c, v) => { if (c === 'role') want.eq = v; return b; }, in: (c, v) => { if (c === 'role') want.in = v; return b; },
        maybeSingle: async () => ({ data: state.role && (!want.eq || want.eq === state.role) && (!want.in || want.in.includes(state.role)) ? { role: state.role } : null, error: null }) };
      return b;
    },
  },
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, signOut: vi.fn() }) }));
vi.mock('../../components/admin/LiveController', () => ({ default: () => <p>live panel</p> }));
vi.mock('../../components/admin/ManageRosters', () => ({ default: () => null }));
vi.mock('../../components/admin/ScheduleMatches', () => ({ default: () => null }));
vi.mock('../../components/admin/ManageNews', () => ({ default: () => null }));
vi.mock('../../components/admin/GradePredictions', () => ({ default: () => null }));
vi.mock('../../components/admin/ManageRegistrations', () => ({ default: () => null }));
vi.mock('../../components/admin/ManageRoles', () => ({ default: () => null }));
vi.mock('../../components/admin/ManageDivisions', () => ({ default: () => <p>divisions panel</p> }));

import { AdminDashboard } from '../AdminDashboard';

afterEach(cleanup);

describe('AdminDashboard divisions tab', () => {
  it('is offered to a dictator and opens the divisions panel', async () => {
    state.role = 'dictator';
    render(<AdminDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /divisions & seasons/i }));
    expect(await screen.findByText('divisions panel')).toBeTruthy();
  });

  it('is not offered to a legacy admin, who gets no dashboard at all', async () => {
    state.role = 'admin';
    render(<AdminDashboard />);
    expect(await screen.findByText(/403 forbidden/i)).toBeTruthy();
    expect(screen.queryByText('live panel')).toBeNull();
    expect(screen.queryByRole('button', { name: /divisions & seasons/i })).toBeNull();
    expect(screen.queryByText('divisions panel')).toBeNull();
  });

  it('keeps everyone else out of the dashboard', async () => {
    state.role = null;
    render(<AdminDashboard />);
    expect(await screen.findByText(/403 forbidden/i)).toBeTruthy();
  });
});

// @vitest-environment jsdom
// Group: frontend-components. The Teams & Rosters tab (season rosters and players) is offered to a stored dictator
// only, like Divisions & Seasons; row level security refuses anyone else's writes anyway. The old "Players" tab,
// which wrote columns the players table never had, is gone; captain assignment stays under "Captains".
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
vi.mock('../../components/admin/ScheduleMatches', () => ({ default: () => null }));
vi.mock('../../components/admin/ManageNews', () => ({ default: () => null }));
vi.mock('../../components/admin/GradePredictions', () => ({ default: () => null }));
vi.mock('../../components/admin/ManageRegistrations', () => ({ default: () => <p>captains panel</p> }));
vi.mock('../../components/admin/ManageRoles', () => ({ default: () => null }));
vi.mock('../../components/admin/ManageDivisions', () => ({ default: () => null }));
vi.mock('../../components/admin/ManageRosters', () => ({ default: () => <p>rosters panel</p> }));

import { AdminDashboard } from '../AdminDashboard';

afterEach(cleanup);

describe('AdminDashboard Teams & Rosters tab', () => {
  it('is offered to a dictator and opens the rosters panel', async () => {
    state.role = 'dictator';
    render(<AdminDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /teams & rosters/i }));
    expect(await screen.findByText('rosters panel')).toBeTruthy();
  });

  it('is not offered to a legacy admin, who gets no dashboard tab at all', async () => {
    state.role = 'admin';
    render(<AdminDashboard />);
    expect(await screen.findByText(/403 forbidden/i)).toBeTruthy();
    for (const tab of [/teams & rosters/i, /captains/i, /live/i, /access control/i]) expect(screen.queryByRole('button', { name: tab })).toBeNull();
  });

  it('no longer offers the old Players tab to anyone', async () => {
    state.role = 'dictator';
    render(<AdminDashboard />);
    await screen.findByText('live panel');
    expect(screen.queryByRole('button', { name: /^players$/i })).toBeNull();
  });
});

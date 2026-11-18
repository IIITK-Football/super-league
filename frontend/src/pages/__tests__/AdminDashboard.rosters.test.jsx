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
      const b = { select: () => b, eq: () => b, in: () => b, maybeSingle: async () => ({ data: state.role ? { role: state.role } : null, error: null }) };
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

  it('is not offered to the legacy admin label, which keeps the captains tab', async () => {
    state.role = 'admin';
    render(<AdminDashboard />);
    expect(await screen.findByText('live panel')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /teams & rosters/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /captains/i }));
    expect(await screen.findByText('captains panel')).toBeTruthy();
  });

  it('no longer offers the old Players tab to anyone', async () => {
    state.role = 'dictator';
    render(<AdminDashboard />);
    await screen.findByText('live panel');
    expect(screen.queryByRole('button', { name: /^players$/i })).toBeNull();
  });
});

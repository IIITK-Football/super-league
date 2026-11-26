// @vitest-environment jsdom
// Group: frontend-components. The dashboard offers each role only what it owns. A dictator gets every tab (Teams &
// Rosters and Divisions & Seasons included, Captains and Scorers for assignments); a scorer gets Live Matches only; a
// captain, an editor, a normal user and the retired legacy admin value get no dashboard at all. Row level security
// refuses anyone else's writes anyway. The old "Players" tab is gone.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = { roles: ['dictator'] };
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, roles: state.roles, hasRole: (r) => Boolean(state.roles?.includes(r)), signOut: vi.fn() }),
}));
vi.mock('../../components/admin/LiveController', () => ({ default: () => <p>live panel</p> }));
vi.mock('../../components/admin/ScheduleMatches', () => ({ default: () => null }));
vi.mock('../../components/admin/ManageNews', () => ({ default: () => null }));
vi.mock('../../components/admin/GradePredictions', () => ({ default: () => null }));
vi.mock('../../components/admin/ManageCaptains', () => ({ default: () => <p>captains panel</p> }));
vi.mock('../../components/admin/ManageScorers', () => ({ default: () => <p>scorers panel</p> }));
vi.mock('../../components/admin/ManageRoles', () => ({ default: () => null }));
vi.mock('../../components/admin/ManageDivisions', () => ({ default: () => null }));
vi.mock('../../components/admin/ManageRosters', () => ({ default: () => <p>rosters panel</p> }));
vi.mock('../../components/admin/AuditHistory', () => ({ default: () => null }));

import { AdminDashboard } from '../AdminDashboard';

afterEach(cleanup);

const tabNames = () => screen.queryAllByRole('button').map((b) => b.textContent.trim().toLowerCase()).filter((t) => t && t !== 'sign out');

describe('AdminDashboard by role', () => {
  it('offers a dictator every tab, and opens the rosters and scorers panels', async () => {
    state.roles = ['dictator'];
    render(<AdminDashboard />);
    await screen.findByText('live panel');
    for (const tab of ['live matches', 'fixtures', 'captains', 'scorers', 'access control', 'grade fantasy', 'news', 'divisions and seasons', 'teams and rosters', 'audit history']) expect(tabNames()).toContain(tab);
    fireEvent.click(screen.getByRole('button', { name: /teams and rosters/i }));
    expect(await screen.findByText('rosters panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^scorers$/i }));
    expect(await screen.findByText('scorers panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^captains$/i }));
    expect(await screen.findByText('captains panel')).toBeTruthy();
  });

  it('offers a scorer Live Matches only: no management tab exists to open', async () => {
    state.roles = ['scorer'];
    render(<AdminDashboard />);
    expect(await screen.findByText('live panel')).toBeTruthy();
    expect(tabNames()).toEqual(['live matches']);
  });

  it('gives a scorer who is also a captain or editor the same single tab: no role implies another', async () => {
    state.roles = ['scorer', 'captain', 'editor'];
    render(<AdminDashboard />);
    await screen.findByText('live panel');
    expect(tabNames()).toEqual(['live matches']);
  });

  it('gives a captain, an editor and a normal user no dashboard at all', async () => {
    for (const roles of [['captain'], ['editor'], []]) {
      state.roles = roles;
      render(<AdminDashboard />);
      expect(await screen.findByText(/403 forbidden/i), roles.join()).toBeTruthy();
      expect(tabNames()).toEqual([]);
      cleanup();
    }
  });

  it('treats the retired legacy admin value as nothing: it is not a role', async () => {
    state.roles = ['admin'];
    render(<AdminDashboard />);
    expect(await screen.findByText(/403 forbidden/i)).toBeTruthy();
  });

  it('shows a waiting state until the grants are known, never the forbidden page first', () => {
    state.roles = null;
    render(<AdminDashboard />);
    expect(screen.getByText(/verifying clearance/i)).toBeTruthy();
    expect(screen.queryByText(/403 forbidden/i)).toBeNull();
  });

  it('no longer offers the old Players tab to anyone', async () => {
    state.roles = ['dictator'];
    render(<AdminDashboard />);
    await screen.findByText('live panel');
    expect(screen.queryByRole('button', { name: /^players$/i })).toBeNull();
  });
});

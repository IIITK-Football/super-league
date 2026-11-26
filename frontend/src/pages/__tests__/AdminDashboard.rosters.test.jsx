// @vitest-environment jsdom
// Group: frontend-components. The workspace sidebar offers each role only what it owns, each tool at its own address.
// A dictator gets the overview and every tool (Teams and rosters and Divisions and seasons included, Captains and
// Scorers for assignments); a scorer gets Live matches only; a scorer who is also an editor and a captain gets just
// their own three tools, never a management tool; a captain, an editor and a normal user cannot open /dictator; the
// retired legacy admin value is nothing. Row level security refuses anyone else's writes anyway. No Players tool.
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = { roles: ['dictator'] };
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, roles: state.roles, loading: false, rolesError: null, hasRole: (r) => Boolean(state.roles?.includes(r)) }),
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const { mockTools, renderWorkspace, navNames } = await import('./workspaceHarness');
mockTools();

afterEach(cleanup);

const DICTATOR = ['overview', 'live matches', 'fixtures', 'divisions and seasons', 'teams and rosters', 'grade predictions', 'captains', 'scorers', 'access control', 'news', 'audit history'];

describe('workspace by role', () => {
  it('offers a dictator the overview and every tool, and opens each at its own address', async () => {
    state.roles = ['dictator'];
    await renderWorkspace('/dictator');
    expect(await screen.findByText('overview panel')).toBeTruthy();
    expect(navNames()).toEqual(DICTATOR);
    for (const [name, panel] of [[/teams and rosters/i, 'ManageRosters'], [/^scorers$/i, 'ManageScorers'], [/^captains$/i, 'ManageCaptains']]) {
      fireEvent.click(screen.getAllByRole('link', { name })[0]);
      expect(await screen.findByText(`${panel} panel`)).toBeTruthy();
      expect(screen.getAllByRole('link', { name })[0].getAttribute('aria-current')).toBe('page');
    }
  });

  it('offers a scorer Live matches only, and sends /dictator there', async () => {
    state.roles = ['scorer'];
    await renderWorkspace('/dictator');
    expect(await screen.findByText('LiveController panel')).toBeTruthy();
    expect(navNames()).toEqual(['live matches']);
  });

  it('gives a scorer who is also a captain and editor their own tools only: no role implies another', async () => {
    state.roles = ['scorer', 'captain', 'editor'];
    await renderWorkspace('/dictator/live');
    await screen.findByText('LiveController panel');
    expect(navNames()).toEqual(['live matches', 'my team', 'news']);
  });

  it('opens the newsletter for an editor and the team builder for a captain, each alone in the sidebar', async () => {
    state.roles = ['editor'];
    await renderWorkspace('/editor');
    expect(await screen.findByText('ManageNews panel')).toBeTruthy();
    expect(navNames()).toEqual(['news']);
    cleanup();
    state.roles = ['captain'];
    await renderWorkspace('/team-builder');
    expect(await screen.findByText('TeamBuilder panel')).toBeTruthy();
    expect(navNames()).toEqual(['my team']);
  });

  it('keeps a captain, an editor, a normal user and the legacy admin value out of /dictator', async () => {
    for (const roles of [['captain'], ['editor'], [], ['admin']]) {
      state.roles = roles;
      await renderWorkspace('/dictator');
      expect(await screen.findByText('You do not have access to this workspace'), roles.join()).toBeTruthy();
      expect(navNames()).toEqual([]);
      cleanup();
    }
  });

  it('no longer offers the old Players tool to anyone', async () => {
    state.roles = ['dictator'];
    await renderWorkspace('/dictator');
    await screen.findByText('overview panel');
    expect(screen.queryByRole('link', { name: /^players$/i })).toBeNull();
  });
});

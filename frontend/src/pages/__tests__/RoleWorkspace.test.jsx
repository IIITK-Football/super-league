// @vitest-environment jsdom
// Group: frontend-components. Each workspace opens only for the grants that own it, and none implies another: a
// dictator opens all three; a scorer reaches the dashboard (which shows them Live Matches only); a captain opens the
// team builder; an editor the newsletter. Anyone else goes home, and someone not signed in goes to the login page.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const auth = { user: { id: 'u1' }, roles: [], loading: false };
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../AdminDashboard', () => ({ AdminDashboard: () => <p>dashboard</p> }));
vi.mock('../TeamBuilder', () => ({ TeamBuilder: () => <p>team builder</p> }));
vi.mock('../../components/admin/ManageNews', () => ({ default: () => <p>newsletter</p> }));

import { RoleWorkspace } from '../RoleWorkspace';

afterEach(cleanup);

function open(requiredRole, roles, over = {}) {
  Object.assign(auth, { user: { id: 'u1' }, roles, loading: false }, over);
  return render(<MemoryRouter initialEntries={['/x']}><Routes>
    <Route path="/x" element={<RoleWorkspace requiredRole={requiredRole} />} />
    <Route path="/" element={<p>home</p>} />
    <Route path="/login" element={<p>login</p>} />
  </Routes></MemoryRouter>);
}

describe('RoleWorkspace', () => {
  it('opens every workspace for a dictator', () => {
    for (const [role, text] of [['dictator', 'dashboard'], ['captain', 'team builder'], ['editor', 'newsletter']]) {
      open(role, ['dictator']);
      expect(screen.getByText(text)).toBeTruthy();
      cleanup();
    }
  });

  it('opens the dashboard for a scorer, the team builder for a captain and the newsletter for an editor', () => {
    open('dictator', ['scorer']); expect(screen.getByText('dashboard')).toBeTruthy(); cleanup();
    open('captain', ['captain']); expect(screen.getByText('team builder')).toBeTruthy(); cleanup();
    open('editor', ['editor']); expect(screen.getByText('newsletter')).toBeTruthy();
  });

  it('sends everyone else home: no role implies another', () => {
    for (const [workspace, roles] of [['dictator', ['captain', 'editor']], ['captain', ['scorer', 'editor']], ['editor', ['captain', 'scorer']], ['dictator', []], ['captain', []]]) {
      open(workspace, roles);
      expect(screen.getByText('home'), `${workspace} with ${roles.join() || 'no grants'}`).toBeTruthy();
      cleanup();
    }
  });

  it('waits while grants load and sends a signed-out visitor to the login page', () => {
    open('dictator', null);
    expect(screen.queryByText('home')).toBeNull();
    expect(screen.queryByText('dashboard')).toBeNull();
    cleanup();
    open('dictator', [], { user: null });
    expect(screen.getByText('login')).toBeTruthy();
  });
});

// @vitest-environment jsdom
// Group: frontend-components. Each workspace opens only for the grants that own it, and none implies another: a
// dictator opens all three; a scorer reaches the dashboard (which shows them Live Matches only); a captain opens the
// team builder; an editor the newsletter. Anyone else sees a plain no-access message, a failed role load a retry, and
// someone not signed in goes to the login page.
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const auth = { user: { id: 'u1' }, roles: [], rolesError: null, retryAuth: vi.fn(), loading: false };
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../AdminDashboard', () => ({ AdminDashboard: () => <p>dashboard</p> }));
vi.mock('../TeamBuilder', () => ({ TeamBuilder: () => <p>team builder</p> }));
vi.mock('../../components/admin/ManageNews', () => ({ default: () => <p>newsletter</p> }));

import { RoleWorkspace } from '../RoleWorkspace';

afterEach(cleanup);

function open(requiredRole, roles, over = {}) {
  Object.assign(auth, { user: { id: 'u1' }, roles, rolesError: null, loading: false }, over);
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

  it('says no access, with a link home, when the grant is missing: no role implies another', () => {
    for (const [workspace, roles] of [['dictator', ['captain', 'editor']], ['captain', ['scorer', 'editor']], ['editor', ['captain', 'scorer']], ['dictator', []], ['captain', []]]) {
      open(workspace, roles);
      expect(screen.getByText('You do not have access to this workspace'), `${workspace} with ${roles.join() || 'no grants'}`).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Go to the home page' }).getAttribute('href')).toBe('/');
      expect(screen.queryByText(/403/)).toBeNull();
      cleanup();
    }
  });

  it('offers a retry, not a no-access message, when loading roles failed', () => {
    const retryAuth = vi.fn();
    open('dictator', null, { rolesError: new Error('down'), retryAuth });
    expect(screen.queryByText('You do not have access to this workspace')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retryAuth).toHaveBeenCalled();
  });

  it('waits while grants load and sends a signed-out visitor to the login page', () => {
    open('dictator', null);
    expect(screen.queryByText('You do not have access to this workspace')).toBeNull();
    expect(screen.queryByText('dashboard')).toBeNull();
    cleanup();
    open('dictator', [], { user: null });
    expect(screen.getByText('login')).toBeTruthy();
  });
});

// @vitest-environment jsdom
// Group: frontend-components. Each workspace address opens only for the grants that own it, and none implies another:
// a dictator opens all of them; a scorer reaching /dictator is sent to Live matches; a captain opens the team builder;
// an editor the newsletter; a tool address opens only for its own grants. Anyone else sees a plain no-access message, a failed role load a retry, and
// someone not signed in goes to the login page.
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const auth = { user: { id: 'u1' }, roles: [], rolesError: null, retryAuth: vi.fn(), loading: false };
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../AdminDashboard', () => ({ AdminDashboard: ({ toolId }) => <p>{{ overview: 'dashboard', team: 'team builder', news: 'newsletter' }[toolId] ?? `tool ${toolId}`}</p> }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));

import { RoleWorkspace } from '../RoleWorkspace';

afterEach(cleanup);

const PATHS = { dictator: '/dictator', captain: '/team-builder', editor: '/editor' };
function open(requiredRole, roles, over = {}, path = PATHS[requiredRole]) {
  Object.assign(auth, { user: { id: 'u1' }, roles, rolesError: null, loading: false }, over);
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    {Object.entries(PATHS).map(([role, p]) => <Route key={p} path={p} element={<RoleWorkspace requiredRole={role} />} />)}
    <Route path="/dictator/:tool" element={<RoleWorkspace requiredRole="dictator" />} />
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
    open('dictator', ['scorer']); expect(screen.getByText('tool live')).toBeTruthy(); cleanup();
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

  it('opens a tool address only for the grants that own it', () => {
    open('dictator', ['dictator'], {}, '/dictator/audit'); expect(screen.getByText('tool audit')).toBeTruthy(); cleanup();
    open('dictator', ['scorer'], {}, '/dictator/live'); expect(screen.getByText('tool live')).toBeTruthy(); cleanup();
    open('dictator', ['editor'], {}, '/dictator/news'); expect(screen.getByText('newsletter')).toBeTruthy(); cleanup();
    for (const [path, roles] of [['/dictator/audit', ['scorer']], ['/dictator/captains', ['captain', 'editor']], ['/dictator/live', ['editor']], ['/dictator/news', ['scorer', 'captain']]]) {
      open('dictator', roles, {}, path);
      expect(screen.getByText('You do not have access to this workspace'), `${path} with ${roles.join()}`).toBeTruthy();
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

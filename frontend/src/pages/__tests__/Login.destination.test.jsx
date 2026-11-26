// @vitest-environment jsdom
// Group: auth-identity. After sign-in the user lands where they were headed, then their role's home, then the home page.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = { user: null, roles: null, rolesError: null, loading: false, retryAuth: vi.fn() };
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));

import { Login } from '../Login';

function setup(entry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/fantasy" element={<div>predictions page</div>} />
        <Route path="/dictator" element={<div>dictator page</div>} />
        <Route path="/" element={<div>home page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  Object.assign(auth, { user: null, roles: null, rolesError: null });
  auth.retryAuth = vi.fn();
});
afterEach(cleanup);

describe('Login destination', () => {
  it('returns a signed-out user to the page they asked for, not the role default', () => {
    const view = setup({ pathname: '/login', state: { from: { pathname: '/fantasy' } } });
    Object.assign(auth, { user: { id: 'u1' }, roles: ['dictator'] });
    view.rerender(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: { pathname: '/fantasy' } } }]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/fantasy" element={<div>predictions page</div>} />
          <Route path="/dictator" element={<div>dictator page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('predictions page')).toBeTruthy();
  });

  it('uses the saved destination after an OAuth round trip, where router state is lost', () => {
    sessionStorage.setItem('authRedirect', '/fantasy');
    Object.assign(auth, { user: { id: 'u1' }, roles: ['captain'] });
    setup('/login');
    expect(screen.getByText('predictions page')).toBeTruthy();
    expect(sessionStorage.getItem('authRedirect')).toBeNull();
  });

  it('sends a dictator with no saved destination to the dictator workspace', () => {
    Object.assign(auth, { user: { id: 'u1' }, roles: ['dictator'] });
    setup('/login');
    expect(screen.getByText('dictator page')).toBeTruthy();
  });

  it('sends a normal user with no saved destination home', () => {
    Object.assign(auth, { user: { id: 'u1' }, roles: [] });
    setup('/login');
    expect(screen.getByText('home page')).toBeTruthy();
  });

  it('offers a retry instead of guessing a destination when roles fail to load', () => {
    Object.assign(auth, { user: { id: 'u1' }, roles: null, rolesError: { message: 'boom' } });
    setup('/login');
    expect(screen.queryByText('home page')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(auth.retryAuth).toHaveBeenCalledTimes(1);
  });
});

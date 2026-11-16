// @vitest-environment jsdom
// Group: auth-identity. A saved post-login destination must never pull a user off the reset page.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = { user: { id: 'u1' } };
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));

import { GlobalAuthRedirect } from '../GlobalAuthRedirect';

function setup(path) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <GlobalAuthRedirect />
      <Routes>
        <Route path="/reset-password" element={<div>reset page</div>} />
        <Route path="/team-builder" element={<div>team builder</div>} />
        <Route path="/other" element={<div>other page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('authRedirect', '/team-builder');
});
afterEach(cleanup);

describe('GlobalAuthRedirect', () => {
  it('leaves the user on the reset page and keeps the saved destination', () => {
    setup('/reset-password');
    expect(screen.getByText('reset page')).toBeTruthy();
    expect(sessionStorage.getItem('authRedirect')).toBe('/team-builder');
  });

  it('sends a signed-in user to the saved destination elsewhere', () => {
    setup('/other');
    expect(screen.getByText('team builder')).toBeTruthy();
    expect(sessionStorage.getItem('authRedirect')).toBeNull();
  });
});

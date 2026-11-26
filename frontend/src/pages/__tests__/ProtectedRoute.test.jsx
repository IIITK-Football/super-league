// @vitest-environment jsdom
// Group: auth-identity. A failed profile load shows a retry; only a missing nickname sends a person to set up a profile.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = {};
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../context/LeagueContext', () => ({ LeagueProvider: ({ children }) => children, useLeague: () => ({}) }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../components/shell/AppShell', () => ({ AppShell: ({ children }) => <div>{children}</div> }));
vi.mock('../Onboarding', () => ({ Onboarding: () => <div>set up your profile</div> }));
vi.mock('../../components/Loader', () => ({ Loader: () => <div>loading</div> }));
vi.mock('../Fantasy', () => ({ Fantasy: () => <div>predictions page</div> }));

import { ProtectedRoute } from '../../App';

function setup() {
  return render(
    <MemoryRouter initialEntries={['/fantasy']}>
      <Routes>
        <Route path="/fantasy" element={<ProtectedRoute><div>predictions page</div></ProtectedRoute>} />
        <Route path="/login" element={<div>sign in page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.assign(auth, { user: { id: 'u1' }, profile: { nickname: 'Ace' }, profileError: null, loading: false, retryAuth: vi.fn() });
});
afterEach(cleanup);

describe('ProtectedRoute', () => {
  it('shows the page for a signed-in user with a nickname', () => {
    setup();
    expect(screen.getByText('predictions page')).toBeTruthy();
  });

  it('shows a retry, not the profile set-up form, when the profile cannot load', () => {
    Object.assign(auth, { profile: null, profileError: { message: 'timeout' } });
    setup();
    expect(screen.queryByText('set up your profile')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(auth.retryAuth).toHaveBeenCalledTimes(1);
  });

  it('sends a user with no profile row to set one up', () => {
    Object.assign(auth, { profile: null });
    setup();
    expect(screen.getByText('set up your profile')).toBeTruthy();
  });

  it('sends a signed-out user to sign in', () => {
    Object.assign(auth, { user: null });
    setup();
    expect(screen.getByText('sign in page')).toBeTruthy();
  });
});

// @vitest-environment jsdom
// Group: auth-identity. A failed role or profile load is reported as a failure, never as "no roles" or "no profile".
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = { roles: { data: [], error: null }, profile: { data: null, error: null } };
const session = { user: { id: 'u1', email: 'ada@iiitkottayam.ac.in' } };
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => {},
    },
    // Like the real query builder: thenable, with no .catch of its own.
    rpc: () => ({ then: (resolve, reject) => Promise.resolve(db.roles).then(resolve, reject) }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => db.profile }) }) }),
  },
}));

import { AuthProvider, useAuth } from '../AuthContext';

function Probe() {
  const { roles, rolesError, profile, profileError, retryAuth } = useAuth();
  return (
    <div>
      <p>roles: {roles === null ? 'unknown' : roles.join(',') || 'none'}</p>
      <p>roles error: {rolesError ? 'yes' : 'no'}</p>
      <p>profile: {profile ? profile.nickname : 'none'}</p>
      <p>profile error: {profileError ? 'yes' : 'no'}</p>
      <button type="button" onClick={retryAuth}>retry</button>
    </div>
  );
}

beforeEach(() => {
  db.roles = { data: [], error: null };
  db.profile = { data: { id: 'u1', nickname: 'Ada' }, error: null };
});
afterEach(cleanup);

describe('AuthProvider load failures', () => {
  it('keeps the roles unknown and reports the error when my_roles fails', async () => {
    db.roles = { data: null, error: { message: 'network' } };
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText('roles error: yes')).toBeTruthy();
    expect(screen.getByText('roles: unknown')).toBeTruthy();
  });

  it('reports a failed profile load instead of a missing profile', async () => {
    db.profile = { data: null, error: { message: 'timeout' } };
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText('profile error: yes')).toBeTruthy();
    expect(screen.getByText('profile: none')).toBeTruthy();
  });

  it('loads the roles and profile again on retry', async () => {
    db.roles = { data: null, error: { message: 'network' } };
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText('roles error: yes');
    db.roles = { data: ['dictator'], error: null };
    screen.getByText('retry').click();
    await waitFor(() => expect(screen.getByText('roles: dictator')).toBeTruthy());
    expect(screen.getByText('roles error: no')).toBeTruthy();
  });

  it('a normal user with no roles is known, not an error', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText('roles: none')).toBeTruthy();
    expect(screen.getByText('roles error: no')).toBeTruthy();
  });
});

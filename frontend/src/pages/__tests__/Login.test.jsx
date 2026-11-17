// @vitest-environment jsdom
// Group: auth-identity. Login page behavior with the real auth rules and a fake Supabase client.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthApi } from '../../lib/authApi';

const state = { api: null, user: null, role: null };
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ ...state.api, user: state.user, role: state.role, loading: false }),
}));

import { Login } from '../Login';

function fakeSupabase(overrides = {}) {
  return {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { session: null, user: { id: 'u1' } }, error: null }),
      signInWithOAuth: vi.fn().mockResolvedValue({ data: {}, error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
      getSession: vi.fn(),
      updateUser: vi.fn(),
      linkIdentity: vi.fn(),
      ...overrides,
    },
  };
}

function setup(sb = fakeSupabase(), route = '/login') {
  state.api = createAuthApi(sb, { origin: 'http://127.0.0.1:5173' });
  render(
    <MemoryRouter initialEntries={[route]}>
      <Login />
    </MemoryRouter>,
  );
  return sb;
}

const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () => fireEvent.click(document.querySelector('form button[type="submit"]'));

beforeEach(() => {
  // These tests cover the page WITHOUT bot protection. Pin that, so a developer's own
  // frontend/.env.local (which may define VITE_TURNSTILE_SITE_KEY) cannot change the result.
  // The Turnstile behaviour is covered by Login.captcha.test.jsx.
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
  sessionStorage.clear();
  state.user = null;
  state.role = null;
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('Login page', () => {
  it('shows the college-email message for another domain without calling Supabase', async () => {
    const sb = setup();
    fill(/college email/i, 'someone@gmail.com');
    fill(/^password/i, 'long-enough-1');
    submit();
    expect((await screen.findByRole('alert')).textContent).toMatch(/@iiitkottayam\.ac\.in/);
    expect(sb.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('signs in with a college email and password', async () => {
    const sb = setup();
    fill(/college email/i, 'student@iiitkottayam.ac.in');
    fill(/^password/i, 'long-enough-1');
    submit();
    await waitFor(() => expect(sb.auth.signInWithPassword).toHaveBeenCalledTimes(1));
  });

  it('sign-up tells existing Google users how to add a password instead', async () => {
    const sb = setup();
    fireEvent.click(screen.getAllByRole('button', { name: /create account/i })[0]);
    fill(/college email/i, 'student@iiitkottayam.ac.in');
    fill(/^password/i, 'long-enough-1');
    submit();
    const notice = await screen.findByRole('status');
    expect(notice.textContent).toMatch(/confirmation link/i);
    expect(notice.textContent).toMatch(/google/i);
    expect(notice.textContent).toMatch(/forgot password/i);
    expect(sb.auth.signUp).toHaveBeenCalledTimes(1);
  });

  it('forgot password asks only for the email and gives a generic answer', async () => {
    const sb = setup();
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    expect(screen.queryByLabelText(/^password/i)).toBeNull();
    fill(/college email/i, 'student@iiitkottayam.ac.in');
    submit();
    expect((await screen.findByRole('status')).textContent).toMatch(/if an account exists/i);
    expect(sb.auth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
  });

  it('starts Google sign-in', async () => {
    const sb = setup();
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    await waitFor(() => expect(sb.auth.signInWithOAuth).toHaveBeenCalledTimes(1));
  });

  it('does not remember a post-login destination when the user came straight to /login', () => {
    setup();
    expect(sessionStorage.getItem('authRedirect')).toBeNull();
  });

  it('remembers the page the user was sent from', () => {
    state.api = createAuthApi(fakeSupabase(), { origin: 'http://127.0.0.1:5173' });
    render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: { pathname: '/fantasy' } } }]}>
        <Login />
      </MemoryRouter>,
    );
    expect(sessionStorage.getItem('authRedirect')).toBe('/fantasy');
  });
});

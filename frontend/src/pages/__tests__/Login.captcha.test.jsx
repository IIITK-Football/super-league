// @vitest-environment jsdom
// Group: auth-identity. The login page asks for the Turnstile check only when it is configured.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthApi } from '../../lib/authApi';

const state = { api: null, widget: null };
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ ...state.api, user: null, role: null, loading: false }),
}));
// Test double: a button that "completes" the check, and a record of the reset key.
vi.mock('../../components/TurnstileWidget', () => ({
  turnstileSiteKey: () => (state.siteKey ? 'site-key' : ''),
  TurnstileWidget: ({ onToken, resetKey }) => {
    state.widget = { onToken, resetKey };
    return <button type="button" onClick={() => onToken('token-1')}>complete verification</button>;
  },
}));

import { Login } from '../Login';

function fakeSupabase() {
  return {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signInWithOAuth: vi.fn().mockResolvedValue({ data: {}, error: null }),
    },
  };
}

function setup() {
  const sb = fakeSupabase();
  state.api = createAuthApi(sb, { origin: 'http://127.0.0.1:5173' });
  render(<MemoryRouter initialEntries={['/login']}><Login /></MemoryRouter>);
  return sb;
}
const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () => fireEvent.click(document.querySelector('form button[type="submit"]'));

beforeEach(() => {
  sessionStorage.clear();
  state.siteKey = false;
});
afterEach(cleanup);

describe('Login page with Turnstile configured', () => {
  beforeEach(() => {
    state.siteKey = true;
  });

  it('asks for the verification before sending a password sign-in', async () => {
    const sb = setup();
    fill(/college email/i, 'student@iiitkottayam.ac.in');
    fill(/^password/i, 'long-enough-1');
    submit();
    expect((await screen.findByRole('alert')).textContent).toMatch(/verification/i);
    expect(sb.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('sends the token with sign-in and asks for a fresh one afterwards', async () => {
    const sb = setup();
    fill(/college email/i, 'student@iiitkottayam.ac.in');
    fill(/^password/i, 'long-enough-1');
    fireEvent.click(screen.getByRole('button', { name: /complete verification/i }));
    const before = state.widget.resetKey;
    submit();
    await waitFor(() => expect(sb.auth.signInWithPassword).toHaveBeenCalledTimes(1));
    expect(sb.auth.signInWithPassword.mock.calls[0][0].options).toEqual({ captchaToken: 'token-1' });
    await waitFor(() => expect(state.widget.resetKey).toBe(before + 1));
  });

  it('sends the token with sign-up and with a reset request', async () => {
    const sb = setup();
    fireEvent.click(screen.getAllByRole('button', { name: /create account/i })[0]);
    fill(/college email/i, 'student@iiitkottayam.ac.in');
    fill(/^password/i, 'long-enough-1');
    fireEvent.click(screen.getByRole('button', { name: /complete verification/i }));
    submit();
    await waitFor(() => expect(sb.auth.signUp).toHaveBeenCalledTimes(1));
    expect(sb.auth.signUp.mock.calls[0][0].options.captchaToken).toBe('token-1');

    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    fireEvent.click(screen.getByRole('button', { name: /complete verification/i }));
    submit();
    await waitFor(() => expect(sb.auth.resetPasswordForEmail).toHaveBeenCalledTimes(1));
    expect(sb.auth.resetPasswordForEmail.mock.calls[0][1].captchaToken).toBe('token-1');
  });

  it('does not require the verification for Google sign-in', async () => {
    const sb = setup();
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    await waitFor(() => expect(sb.auth.signInWithOAuth).toHaveBeenCalledTimes(1));
  });
});

describe('Login page without Turnstile configured', () => {
  it('signs in without a token', async () => {
    const sb = setup();
    fill(/college email/i, 'student@iiitkottayam.ac.in');
    fill(/^password/i, 'long-enough-1');
    submit();
    await waitFor(() => expect(sb.auth.signInWithPassword).toHaveBeenCalledTimes(1));
    expect(sb.auth.signInWithPassword.mock.calls[0][0].options).toBeUndefined();
  });
});

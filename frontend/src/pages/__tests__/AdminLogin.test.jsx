// @vitest-environment jsdom
// Group: auth-identity. HQ password login: college rule, and Turnstile only when configured.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = { siteKey: false };
const signInWithPassword = vi.fn();
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { signInWithPassword: (...a) => signInWithPassword(...a) } } }));
vi.mock('../../components/TurnstileWidget', () => ({
  turnstileSiteKey: () => (state.siteKey ? 'site-key' : ''),
  TurnstileWidget: ({ onToken }) => <button type="button" onClick={() => onToken('token-1')}>complete verification</button>,
}));

import { AdminLogin } from '../AdminLogin';

const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () => fireEvent.click(document.querySelector('form button[type="submit"]'));

beforeEach(() => {
  signInWithPassword.mockReset().mockResolvedValue({ data: {}, error: null });
  state.siteKey = false;
});
afterEach(cleanup);

describe('AdminLogin', () => {
  it('rejects a non-college email without calling Supabase', async () => {
    render(<AdminLogin />);
    fill(/admin email/i, 'x@gmail.com');
    fill(/passcode/i, 'long-enough-1');
    submit();
    expect(await screen.findByText(/@iiitkottayam\.ac\.in/)).toBeTruthy();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('signs in without a token when verification is not configured', async () => {
    render(<AdminLogin />);
    fill(/admin email/i, 'admin@iiitkottayam.ac.in');
    fill(/passcode/i, 'long-enough-1');
    submit();
    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(1));
    expect(signInWithPassword.mock.calls[0][0]).toEqual({ email: 'admin@iiitkottayam.ac.in', password: 'long-enough-1' });
  });

  it('needs the verification when configured, then sends the token', async () => {
    state.siteKey = true;
    render(<AdminLogin />);
    fill(/admin email/i, 'admin@iiitkottayam.ac.in');
    fill(/passcode/i, 'long-enough-1');
    submit();
    expect(await screen.findByText(/complete the verification/i)).toBeTruthy();
    expect(signInWithPassword).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /complete verification/i }));
    submit();
    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(1));
    expect(signInWithPassword.mock.calls[0][0].options).toEqual({ captchaToken: 'token-1' });
  });

  it('shows a verification message, not "invalid credentials", when the check fails', async () => {
    state.siteKey = true;
    signInWithPassword.mockResolvedValue({ data: {}, error: { message: 'captcha verification process failed' } });
    render(<AdminLogin />);
    fill(/admin email/i, 'admin@iiitkottayam.ac.in');
    fill(/passcode/i, 'long-enough-1');
    fireEvent.click(screen.getByRole('button', { name: /complete verification/i }));
    submit();
    expect(await screen.findByText(/verification did not complete/i)).toBeTruthy();
  });
});

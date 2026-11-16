// @vitest-environment jsdom
// Group: auth-identity. Profile password section (Google users add a password to the same account).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const auth = { setPassword: vi.fn() };
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));

import { PasswordSettings } from '../PasswordSettings';

const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
afterEach(() => {
  cleanup();
  auth.setPassword = vi.fn();
});

describe('PasswordSettings', () => {
  it('refuses mismatched passwords locally', () => {
    render(<PasswordSettings />);
    fill('New password', 'long-enough-1');
    fill('Confirm new password', 'different-long-2');
    fireEvent.click(screen.getByRole('button', { name: /save password/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/do not match/i);
    expect(auth.setPassword).not.toHaveBeenCalled();
  });

  it('saves on the current account and confirms', async () => {
    auth.setPassword = vi.fn().mockResolvedValue({ error: null });
    render(<PasswordSettings />);
    fill('New password', 'long-enough-1');
    fill('Confirm new password', 'long-enough-1');
    fireEvent.click(screen.getByRole('button', { name: /save password/i }));
    expect((await screen.findByRole('status')).textContent).toMatch(/password saved/i);
    expect(auth.setPassword).toHaveBeenCalledWith('long-enough-1');
  });

  it('shows an error from the server', async () => {
    auth.setPassword = vi.fn().mockResolvedValue({ error: 'Please sign in first.' });
    render(<PasswordSettings />);
    fill('New password', 'long-enough-1');
    fill('Confirm new password', 'long-enough-1');
    fireEvent.click(screen.getByRole('button', { name: /save password/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/sign in first/i);
  });
});

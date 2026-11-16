// @vitest-environment jsdom
// Group: auth-identity. The profile password section asks for an emailed code only when Supabase requires it.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const auth = { setPassword: vi.fn(), requestPasswordChangeCode: vi.fn() };
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));

import { PasswordSettings } from '../PasswordSettings';

const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => fireEvent.click(screen.getByRole('button', { name: /save password/i }));
function fillPasswords() {
  fill('New password', 'long-enough-1');
  fill('Confirm new password', 'long-enough-1');
}

afterEach(() => {
  cleanup();
  auth.setPassword = vi.fn();
  auth.requestPasswordChangeCode = vi.fn();
});

describe('PasswordSettings with reauthentication', () => {
  it('does not show a code field unless one is needed', () => {
    render(<PasswordSettings />);
    expect(screen.queryByLabelText(/code/i)).toBeNull();
  });

  it('sends a code and asks for it when Supabase requires reauthentication', async () => {
    auth.setPassword = vi.fn().mockResolvedValue({ error: 'For your security, enter the code we email you.', needsReauth: true });
    auth.requestPasswordChangeCode = vi.fn().mockResolvedValue({ error: null, message: 'We emailed a code to your college address.' });
    render(<PasswordSettings />);
    fillPasswords();
    save();
    expect(await screen.findByLabelText(/code/i)).toBeTruthy();
    expect(auth.requestPasswordChangeCode).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toMatch(/emailed a code/i);
  });

  it('saves with the code and confirms', async () => {
    auth.setPassword = vi
      .fn()
      .mockResolvedValueOnce({ error: 'For your security, enter the code we email you.', needsReauth: true })
      .mockResolvedValueOnce({ error: null });
    auth.requestPasswordChangeCode = vi.fn().mockResolvedValue({ error: null, message: 'We emailed a code to your college address.' });
    render(<PasswordSettings />);
    fillPasswords();
    save();
    fill(await screen.findByLabelText(/code/i) && /code/i, '123456');
    save();
    await waitFor(() => expect(auth.setPassword).toHaveBeenLastCalledWith('long-enough-1', '123456'));
    expect((await screen.findByRole('status')).textContent).toMatch(/password saved/i);
    expect(screen.queryByLabelText(/code/i)).toBeNull();
  });

  it('keeps the code field and the error when the code is wrong', async () => {
    auth.setPassword = vi
      .fn()
      .mockResolvedValueOnce({ error: 'For your security, enter the code we email you.', needsReauth: true })
      .mockResolvedValueOnce({ error: 'That code is incorrect or has expired. Send a new code.', needsReauth: true });
    auth.requestPasswordChangeCode = vi.fn().mockResolvedValue({ error: null, message: 'We emailed a code.' });
    render(<PasswordSettings />);
    fillPasswords();
    save();
    fill(await screen.findByLabelText(/code/i) && /code/i, '000000');
    save();
    expect((await screen.findByRole('alert')).textContent).toMatch(/incorrect or has expired/i);
    expect(screen.getByLabelText(/code/i)).toBeTruthy();
  });

  it('can send a new code', async () => {
    auth.setPassword = vi.fn().mockResolvedValue({ error: 'x', needsReauth: true });
    auth.requestPasswordChangeCode = vi.fn().mockResolvedValue({ error: null, message: 'We emailed a code.' });
    render(<PasswordSettings />);
    fillPasswords();
    save();
    await screen.findByLabelText(/code/i);
    fireEvent.click(screen.getByRole('button', { name: /send a new code/i }));
    await waitFor(() => expect(auth.requestPasswordChangeCode).toHaveBeenCalledTimes(2));
  });
});

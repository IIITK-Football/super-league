// @vitest-environment jsdom
// Group: auth-identity. Password reset page.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const auth = { user: { id: 'u1' }, loading: false, completePasswordReset: vi.fn() };
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));

vi.mock('../../components/Loader', () => ({ Loader: () => <div>loading</div> })); // canvas is not available in jsdom

import { ResetPassword } from '../ResetPassword';

function setup() {
  render(
    <MemoryRouter initialEntries={['/reset-password']}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/" element={<div>home page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}
const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

afterEach(() => {
  cleanup();
  auth.user = { id: 'u1' };
  auth.loading = false;
  auth.completePasswordReset = vi.fn();
});

describe('ResetPassword page', () => {
  it('explains an invalid or expired link when there is no recovery session', () => {
    auth.user = null;
    setup();
    expect(screen.getByRole('alert').textContent).toMatch(/invalid or has expired/i);
    expect(screen.queryByLabelText(/new password/i)).toBeNull();
  });

  it('rejects mismatched passwords without calling Supabase', async () => {
    setup();
    fill(/new password/i, 'long-enough-1');
    fill(/confirm password/i, 'different-long-2');
    fireEvent.click(screen.getByRole('button', { name: /save password/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/do not match/i);
    expect(auth.completePasswordReset).not.toHaveBeenCalled();
  });

  it('shows the error returned for a weak password', async () => {
    auth.completePasswordReset = vi.fn().mockResolvedValue({ error: 'Use a password of at least 8 characters.' });
    setup();
    fill(/new password/i, 'short');
    fill(/confirm password/i, 'short');
    fireEvent.click(screen.getByRole('button', { name: /save password/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/at least 8/);
  });

  it('saves the new password and goes home', async () => {
    auth.completePasswordReset = vi.fn().mockResolvedValue({ error: null });
    setup();
    fill(/new password/i, 'long-enough-1');
    fill(/confirm password/i, 'long-enough-1');
    fireEvent.click(screen.getByRole('button', { name: /save password/i }));
    await waitFor(() => expect(screen.getByText('home page')).toBeTruthy());
    expect(auth.completePasswordReset).toHaveBeenCalledWith('long-enough-1');
  });
});

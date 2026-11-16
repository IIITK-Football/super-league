// Group: auth-identity. Changing a password can require an emailed one-time code (Secure password change).
import { describe, expect, it, vi } from 'vitest';
import { createAuthApi } from '../authApi';

const session = { user: { id: 'u1', email: 'student@iiitkottayam.ac.in' } };
function fakeSupabase(overrides = {}) {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session } }),
      updateUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }),
      reauthenticate: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signUp: vi.fn(),
      ...overrides,
    },
  };
}
const origin = 'http://127.0.0.1:5173';

describe('setPassword with reauthentication', () => {
  it('changes the password directly when Supabase does not ask for a code', async () => {
    const sb = fakeSupabase();
    const r = await createAuthApi(sb, { origin }).setPassword('long-enough-1');
    expect(r).toEqual({ error: null });
    expect(sb.auth.updateUser).toHaveBeenCalledWith({ password: 'long-enough-1' });
  });

  it('reports that a code is needed, without treating it as a failure of the password', async () => {
    const sb = fakeSupabase({
      updateUser: vi.fn().mockResolvedValue({ data: {}, error: { message: 'Password update requires reauthentication' } }),
    });
    const r = await createAuthApi(sb, { origin }).setPassword('long-enough-1');
    expect(r.needsReauth).toBe(true);
    expect(r.error).toMatch(/code/i);
  });

  it('sends the one-time code as the nonce', async () => {
    const sb = fakeSupabase();
    const r = await createAuthApi(sb, { origin }).setPassword('long-enough-1', ' 123456 ');
    expect(r.error).toBeNull();
    expect(sb.auth.updateUser).toHaveBeenCalledWith({ password: 'long-enough-1', nonce: '123456' });
  });

  it('explains a wrong or expired code and keeps asking for one', async () => {
    const sb = fakeSupabase({
      updateUser: vi.fn().mockResolvedValue({ data: {}, error: { message: 'Nonce has expired or is invalid' } }),
    });
    const r = await createAuthApi(sb, { origin }).setPassword('long-enough-1', '000000');
    expect(r.needsReauth).toBe(true);
    expect(r.error).toMatch(/incorrect or has expired/i);
  });

  it('still never creates a user and still needs a session and a valid password', async () => {
    const sb = fakeSupabase({ getSession: vi.fn().mockResolvedValue({ data: { session: null } }) });
    expect((await createAuthApi(sb, { origin }).setPassword('long-enough-1')).error).toMatch(/sign in/i);
    expect((await createAuthApi(fakeSupabase(), { origin }).setPassword('short')).error).toMatch(/at least 8/);
    expect(sb.auth.signUp).not.toHaveBeenCalled();
  });
});

describe('requestPasswordChangeCode', () => {
  it('asks Supabase to email a code to the signed-in account', async () => {
    const sb = fakeSupabase();
    const r = await createAuthApi(sb, { origin }).requestPasswordChangeCode();
    expect(sb.auth.reauthenticate).toHaveBeenCalledTimes(1);
    expect(r.error).toBeNull();
    expect(r.message).toMatch(/emailed a code/i);
  });

  it('needs a signed-in session', async () => {
    const sb = fakeSupabase({ getSession: vi.fn().mockResolvedValue({ data: { session: null } }) });
    expect((await createAuthApi(sb, { origin }).requestPasswordChangeCode()).error).toMatch(/sign in/i);
    expect(sb.auth.reauthenticate).not.toHaveBeenCalled();
  });

  it('shows a rate-limit message', async () => {
    const sb = fakeSupabase({ reauthenticate: vi.fn().mockResolvedValue({ data: {}, error: { message: 'email rate limit exceeded' } }) });
    expect((await createAuthApi(sb, { origin }).requestPasswordChangeCode()).error).toMatch(/too many/i);
  });
});

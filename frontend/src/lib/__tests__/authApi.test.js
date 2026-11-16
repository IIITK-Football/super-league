// Group: auth-identity. Auth actions must enforce the college rule before calling Supabase and
// must reuse the signed-in account (updateUser / linkIdentity) instead of creating another user.
import { describe, expect, it, vi } from 'vitest';
import { createAuthApi } from '../authApi';

function fakeSupabase(overrides = {}) {
  const auth = {
    signInWithPassword: vi.fn().mockResolvedValue({ data: { session: {} }, error: null }),
    signUp: vi.fn().mockResolvedValue({ data: { session: null, user: { id: 'u1' } }, error: null }),
    signInWithOAuth: vi.fn().mockResolvedValue({ data: {}, error: null }),
    updateUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
    linkIdentity: vi.fn().mockResolvedValue({ data: {}, error: null }),
    getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }),
    ...overrides,
  };
  return { auth };
}
const origin = 'http://127.0.0.1:5173';
const college = 'student@iiitkottayam.ac.in';

describe('domain rule before any Supabase call', () => {
  it.each(['signInWithPassword', 'signUpWithPassword', 'requestPasswordReset'])('%s rejects non-college email', async (fn) => {
    const sb = fakeSupabase();
    const api = createAuthApi(sb, { origin });
    const r = await api[fn]('someone@gmail.com', 'long-enough-1');
    expect(r.error).toMatch(/@iiitkottayam\.ac\.in/);
    expect(sb.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(sb.auth.signUp).not.toHaveBeenCalled();
    expect(sb.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe('password sign-in and sign-up', () => {
  it('signs in with a trimmed college email', async () => {
    const sb = fakeSupabase();
    const r = await createAuthApi(sb, { origin }).signInWithPassword(`  ${college} `, 'pw-long-enough');
    expect(r.error).toBeNull();
    expect(sb.auth.signInWithPassword).toHaveBeenCalledWith({ email: college, password: 'pw-long-enough' });
  });

  it('turns provider errors into readable messages', async () => {
    const sb = fakeSupabase({
      signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: { message: 'Invalid login credentials' } }),
    });
    const r = await createAuthApi(sb, { origin }).signInWithPassword(college, 'wrong-password');
    expect(r.error).toMatch(/email or password/i);

    const sb2 = fakeSupabase({
      signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: { message: 'Email not confirmed' } }),
    });
    expect((await createAuthApi(sb2, { origin }).signInWithPassword(college, 'pw-long-enough')).error).toMatch(/confirm/i);
  });

  it('sign-up validates the password, redirects back to /login and reports email confirmation', async () => {
    const sb = fakeSupabase();
    const api = createAuthApi(sb, { origin });
    expect((await api.signUpWithPassword(college, 'short')).error).toMatch(/at least 8/);
    expect(sb.auth.signUp).not.toHaveBeenCalled();

    const r = await api.signUpWithPassword(college, 'long-enough-1');
    expect(r.error).toBeNull();
    expect(r.needsConfirmation).toBe(true);
    expect(sb.auth.signUp).toHaveBeenCalledWith({
      email: college,
      password: 'long-enough-1',
      options: { emailRedirectTo: `${origin}/login` },
    });
  });
});

describe('same-account password for a Google user', () => {
  it('sets the password with updateUser on the current session and never creates a user', async () => {
    const sb = fakeSupabase();
    const r = await createAuthApi(sb, { origin }).setPassword('long-enough-1');
    expect(r.error).toBeNull();
    expect(sb.auth.updateUser).toHaveBeenCalledWith({ password: 'long-enough-1' });
    expect(sb.auth.signUp).not.toHaveBeenCalled();
  });

  it('needs a signed-in session and a valid password', async () => {
    const noSession = fakeSupabase({ getSession: vi.fn().mockResolvedValue({ data: { session: null } }) });
    expect((await createAuthApi(noSession, { origin }).setPassword('long-enough-1')).error).toMatch(/sign in/i);
    expect(noSession.auth.updateUser).not.toHaveBeenCalled();

    const sb = fakeSupabase();
    expect((await createAuthApi(sb, { origin }).setPassword('short')).error).toMatch(/at least 8/);
    expect(sb.auth.updateUser).not.toHaveBeenCalled();
  });
});

describe('Google identity', () => {
  it('starts OAuth with an account chooser and a college-domain hint, returning to /login', async () => {
    const sb = fakeSupabase();
    await createAuthApi(sb, { origin }).signInWithGoogle();
    expect(sb.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: `${origin}/login`, queryParams: { prompt: 'select_account', hd: 'iiitkottayam.ac.in' } },
    });
  });

  it('explains when Google is not configured for this environment', async () => {
    const sb = fakeSupabase({
      signInWithOAuth: vi.fn().mockResolvedValue({ data: {}, error: { message: 'Unsupported provider: provider is not enabled' } }),
    });
    expect((await createAuthApi(sb, { origin }).signInWithGoogle()).error).toMatch(/not (set up|configured)/i);
  });

  it('links Google to the signed-in account (no second user)', async () => {
    const sb = fakeSupabase();
    await createAuthApi(sb, { origin }).linkGoogle();
    expect(sb.auth.linkIdentity).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: `${origin}/profile` },
    });
    expect(sb.auth.signUp).not.toHaveBeenCalled();
  });
});

describe('password reset', () => {
  it('sends the reset link back to /reset-password and always answers generically', async () => {
    const sb = fakeSupabase();
    const api = createAuthApi(sb, { origin });
    const r = await api.requestPasswordReset(college);
    expect(sb.auth.resetPasswordForEmail).toHaveBeenCalledWith(college, { redirectTo: `${origin}/reset-password` });
    expect(r.error).toBeNull();
    expect(r.message).toMatch(/if an account/i);

    const failing = fakeSupabase({
      resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: { message: 'User not found' } }),
    });
    const r2 = await createAuthApi(failing, { origin }).requestPasswordReset(college);
    expect(r2.error).toBeNull(); // no account enumeration
  });

  it('completes a reset with updateUser', async () => {
    const sb = fakeSupabase();
    const r = await createAuthApi(sb, { origin }).completePasswordReset('long-enough-1');
    expect(r.error).toBeNull();
    expect(sb.auth.updateUser).toHaveBeenCalledWith({ password: 'long-enough-1' });
  });
});

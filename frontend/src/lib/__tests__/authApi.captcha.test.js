// Group: auth-identity. Turnstile tokens are passed to Supabase Auth, which verifies them server-side.
import { describe, expect, it, vi } from 'vitest';
import { createAuthApi } from '../authApi';

function fakeSupabase(overrides = {}) {
  return {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ data: { session: {} }, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
      ...overrides,
    },
  };
}
const origin = 'http://127.0.0.1:5173';
const email = 'student@iiitkottayam.ac.in';

describe('captcha token', () => {
  it('is sent with password sign-in', async () => {
    const sb = fakeSupabase();
    await createAuthApi(sb, { origin }).signInWithPassword(email, 'long-enough-1', 'tok');
    expect(sb.auth.signInWithPassword).toHaveBeenCalledWith({ email, password: 'long-enough-1', options: { captchaToken: 'tok' } });
  });

  it('is sent with sign-up next to the confirmation redirect', async () => {
    const sb = fakeSupabase();
    await createAuthApi(sb, { origin }).signUpWithPassword(email, 'long-enough-1', 'tok');
    expect(sb.auth.signUp).toHaveBeenCalledWith({
      email,
      password: 'long-enough-1',
      options: { emailRedirectTo: `${origin}/login`, captchaToken: 'tok' },
    });
  });

  it('is sent with a password reset request', async () => {
    const sb = fakeSupabase();
    await createAuthApi(sb, { origin }).requestPasswordReset(email, 'tok');
    expect(sb.auth.resetPasswordForEmail).toHaveBeenCalledWith(email, { redirectTo: `${origin}/reset-password`, captchaToken: 'tok' });
  });

  it('is left out when there is no token (verification not enabled)', async () => {
    const sb = fakeSupabase();
    const api = createAuthApi(sb, { origin });
    await api.signInWithPassword(email, 'long-enough-1');
    await api.signInWithPassword(email, 'long-enough-1', null);
    expect(sb.auth.signInWithPassword).toHaveBeenNthCalledWith(1, { email, password: 'long-enough-1' });
    expect(sb.auth.signInWithPassword).toHaveBeenNthCalledWith(2, { email, password: 'long-enough-1' });
  });

  it('does not contact Supabase for a non-college email even with a token', async () => {
    const sb = fakeSupabase();
    const r = await createAuthApi(sb, { origin }).signInWithPassword('a@gmail.com', 'long-enough-1', 'tok');
    expect(r.error).toMatch(/@iiitkottayam\.ac\.in/);
    expect(sb.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('turns a failed verification into a readable message', async () => {
    const sb = fakeSupabase({
      signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: { message: 'captcha verification process failed' } }),
    });
    const r = await createAuthApi(sb, { origin }).signInWithPassword(email, 'long-enough-1', 'bad');
    expect(r.error).toMatch(/verification/i);
    expect(r.error).not.toMatch(/captcha verification process failed/);
  });

  it('a rate limit message still wins over a generic one', async () => {
    const sb = fakeSupabase({
      resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: { message: 'email rate limit exceeded' } }),
    });
    const r = await createAuthApi(sb, { origin }).requestPasswordReset(email, 'tok');
    expect(r.error).toMatch(/too many/i);
  });
});

// Group: auth-identity. Turnstile on the LOCAL Auth service (127.0.0.1:54321 only).
// Enabled by [auth.captcha] in supabase/config.toml, which takes effect after the local stack is
// restarted (pnpm db:stop && pnpm db:start). Until then these checks skip with that instruction.
import { beforeAll, describe, expect, it } from 'vitest';
import { CAPTCHA_TEST_TOKEN, captchaEnabled, clients, cloudflareReachable, localKeys, uniqueEmail } from './local-supabase';

let c: ReturnType<typeof clients>;
let enabled = false;
let online = false;
const created: string[] = [];

beforeAll(async () => {
  c = clients(localKeys());
  enabled = await captchaEnabled(c.anonWithoutCaptcha());
  online = await cloudflareReachable();
});

const skipUnlessEnabled = (ctx: { skip: (note?: string) => void }) => {
  if (enabled) return;
  const hint = 'CAPTCHA is not enabled on the running local Auth service: restart it with pnpm db:stop && pnpm db:start';
  if (process.env.CI) throw new Error(hint); // CI starts the stack from config.toml, so this must be on
  ctx.skip(hint);
};

describe('Turnstile on password endpoints', () => {
  it('rejects a password sign-in with no token', async (ctx) => {
    skipUnlessEnabled(ctx);
    const { error } = await c.anonWithoutCaptcha().auth.signInWithPassword({ email: 'a@iiitkottayam.ac.in', password: 'long-enough-1' });
    expect(error?.message).toMatch(/captcha/i);
  });

  it('rejects a sign-up with no token before creating anyone', async (ctx) => {
    skipUnlessEnabled(ctx);
    const email = uniqueEmail('nocaptcha');
    const { error } = await c.anonWithoutCaptcha().auth.signUp({ email, password: 'long-enough-1' });
    expect(error?.message).toMatch(/captcha/i);
    const { data } = await c.admin.auth.admin.listUsers({ perPage: 1000 });
    expect(data.users.some((u) => u.email === email)).toBe(false);
  });

  it('rejects a reset request with no token', async (ctx) => {
    skipUnlessEnabled(ctx);
    const { error } = await c.anonWithoutCaptcha().auth.resetPasswordForEmail('a@iiitkottayam.ac.in');
    expect(error?.message).toMatch(/captcha/i);
  });

  it('accepts the Cloudflare test token for sign-in (verified by Supabase Auth)', async (ctx) => {
    skipUnlessEnabled(ctx);
    if (!online) ctx.skip('Cloudflare siteverify is not reachable from this machine');
    const email = uniqueEmail('withcaptcha');
    const { data, error } = await c.admin.auth.admin.createUser({ email, password: 'correct-horse-battery-1', email_confirm: true });
    expect(error).toBeNull();
    created.push(data.user!.id);
    const login = await c.anonWithoutCaptcha().auth.signInWithPassword({
      email,
      password: 'correct-horse-battery-1',
      options: { captchaToken: CAPTCHA_TEST_TOKEN },
    });
    expect(login.error).toBeNull();
    expect(login.data.user?.id).toBe(data.user!.id);
    await c.admin.auth.admin.deleteUser(data.user!.id);
  });

  it('does not affect Google or authenticated password changes (no token needed)', async (ctx) => {
    skipUnlessEnabled(ctx);
    // updateUser on a signed-in session is not a CAPTCHA-protected endpoint.
    const email = uniqueEmail('updateuser');
    const { data } = await c.admin.auth.admin.createUser({ email, email_confirm: true });
    const link = await c.admin.auth.admin.generateLink({ type: 'magiclink', email });
    const client = c.anonWithoutCaptcha();
    expect((await client.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'magiclink' })).error).toBeNull();
    expect((await client.auth.updateUser({ password: 'correct-horse-battery-2' })).error).toBeNull();
    await c.admin.auth.admin.deleteUser(data.user!.id);
  });
});

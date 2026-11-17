// Test helper: connects to THIS repository's local Supabase stack only (127.0.0.1:54321).
import { spawnSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const MAILPIT = 'http://127.0.0.1:54324';

type Keys = { url: string; publishable: string; secret: string };

export function localKeys(): Keys {
  const r = spawnSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], { encoding: 'utf8', cwd: `${__dirname}/../..` });
  if (r.status !== 0) throw new Error('Local Supabase is not running. Start it with: pnpm db:start');
  const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  if (out.API_URL !== 'http://127.0.0.1:54321') throw new Error('Refusing to run: API is not the local stack on 127.0.0.1:54321');
  if (!out.PUBLISHABLE_KEY || !out.SECRET_KEY) throw new Error('This Supabase CLI does not report publishable/secret keys; upgrade it.');
  return { url: out.API_URL, publishable: out.PUBLISHABLE_KEY, secret: out.SECRET_KEY };
}

// Dummy token Cloudflare documents for its always-pass TEST secret (the local default). It is
// ignored when CAPTCHA is not enabled, so existing tests behave the same either way.
export const CAPTCHA_TEST_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

export function clients(keys: Keys): {
  anon: () => SupabaseClient;
  anonWithoutCaptcha: () => SupabaseClient;
  admin: SupabaseClient;
} {
  const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const plain = () => createClient(keys.url, keys.publishable, opts);
  return {
    // Adds the test token to the three password endpoints, like the real app does.
    anon: () => {
      const c = plain();
      const auth = c.auth as any;
      const withToken = (o: any = {}) => ({ ...o, options: { ...(o.options ?? {}), captchaToken: CAPTCHA_TEST_TOKEN } });
      const signIn = auth.signInWithPassword.bind(auth);
      const signUp = auth.signUp.bind(auth);
      const reset = auth.resetPasswordForEmail.bind(auth);
      auth.signInWithPassword = (cred: any) => signIn(withToken(cred));
      auth.signUp = (cred: any) => signUp(withToken(cred));
      auth.resetPasswordForEmail = (email: string, o: any = {}) => reset(email, { ...o, captchaToken: CAPTCHA_TEST_TOKEN });
      return c;
    },
    anonWithoutCaptcha: plain,
    admin: createClient(keys.url, keys.secret, opts),
  };
}

// True when the running local Auth service rejects a password sign-in that has no token.
export async function captchaEnabled(client: SupabaseClient): Promise<boolean> {
  const { error } = await client.auth.signInWithPassword({ email: 'probe@iiitkottayam.ac.in', password: 'probe-password-1' });
  return /captcha/i.test(error?.message ?? '');
}

// Cloudflare's siteverify must be reachable for a token to pass; skip those checks when offline.
export async function cloudflareReachable(): Promise<boolean> {
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      signal: AbortSignal.timeout(4000),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

export const uniqueEmail = (label: string, domain = 'iiitkottayam.ac.in') =>
  `authtest.${label}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@${domain}`;

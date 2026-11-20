// Group: api-services. SL-025 through the real local Auth, Data API and Worker: profile emails are unreadable by
// visitors and signed-in users; a user changes only their own profile and never its email or id; visitors cannot write
// anything; the World Cup flair route needs a session and changes only the caller's own flair.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createApp } from '../src/app';
import { clients, localKeys, uniqueEmail } from '../../backend/tests/auth/local-supabase';

const keys = localKeys();
const c = clients(keys);
const admin = c.admin;
let app: ReturnType<typeof createApp>;
const users: { id: string; email: string; token: string }[] = [];

async function account(label: string) {
  const email = uniqueEmail(`sec-${label}`);
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const v = await c.anon().auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'magiclink' });
  if (v.error) throw v.error;
  const u = { id: data.user.id, email, token: v.data.session!.access_token };
  users.push(u);
  return u;
}
const as = (token: string) => createClient(keys.url, keys.publishable, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });

let alice: Awaited<ReturnType<typeof account>>;
let bob: Awaited<ReturnType<typeof account>>;

beforeAll(async () => {
  Object.assign(process.env, { SUPABASE_URL: keys.url, SUPABASE_PUBLISHABLE_KEY: keys.publishable, SUPABASE_SECRET_KEY: keys.secret, SL_ENVIRONMENT: 'local' });
  app = createApp();
  alice = await account('alice');
  bob = await account('bob');
}, 60000);

afterAll(async () => {
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
}, 30000);

describe('profile privacy and ownership', () => {
  it('visitors and signed-in users cannot read profile emails, but can read public profile fields', async () => {
    const anonEmail = await c.anonWithoutCaptcha().from('user_profiles').select('email').limit(1);
    expect(anonEmail.error?.message).toMatch(/permission denied/);
    const ownEmail = await as(alice.token).from('user_profiles').select('email').eq('id', alice.id);
    expect(ownEmail.error?.message).toMatch(/permission denied/);
    const pub = await c.anonWithoutCaptcha().from('user_profiles').select('id, nickname').eq('id', alice.id);
    expect(pub.error).toBeNull();
    expect(pub.data).toHaveLength(1);
  });

  it('a user changes their own nickname but never their email', async () => {
    const ok = await as(alice.token).from('user_profiles').update({ nickname: 'Alice' }).eq('id', alice.id).select('nickname');
    expect(ok.error).toBeNull();
    expect(ok.data?.[0]?.nickname).toBe('Alice');
    const email = await as(alice.token).from('user_profiles').update({ email: 'stolen@iiitkottayam.ac.in' }).eq('id', alice.id);
    expect(email.error?.message).toMatch(/permission denied/);
    const stored = await admin.from('user_profiles').select('email').eq('id', alice.id).single();
    expect(stored.data?.email).toBe(alice.email);
  });

  it("a user cannot change someone else's profile", async () => {
    const res = await as(alice.token).from('user_profiles').update({ nickname: 'Hacked' }).eq('id', bob.id).select('id');
    expect(res.data ?? []).toHaveLength(0);
    expect((await admin.from('user_profiles').select('nickname').eq('id', bob.id).single()).data?.nickname).not.toBe('Hacked');
  });

  it('visitors cannot write any table', async () => {
    const res = await c.anonWithoutCaptcha().from('newsletter').insert({ title: 'x' });
    expect(res.error?.message).toMatch(/permission denied/);
  });
});

describe('World Cup flair route', () => {
  const patch = (token: string | null, body: unknown) =>
    app.request('http://localhost/api/wc/flair', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  it('needs a session', async () => {
    expect((await patch(null, { user_id: alice.id, wc_team_flair: 'Brazil' })).status).toBe(401);
  });

  it("refuses to change another user's flair", async () => {
    expect((await patch(alice.token, { user_id: bob.id, wc_team_flair: 'Brazil' })).status).toBe(403);
    expect((await admin.from('user_profiles').select('wc_team_flair').eq('id', bob.id).single()).data?.wc_team_flair).not.toBe('Brazil');
  });

  it("changes the caller's own flair", async () => {
    const res = await patch(alice.token, { user_id: alice.id, wc_team_flair: 'Argentina' });
    expect(res.status).toBe(200);
    expect((await admin.from('user_profiles').select('wc_team_flair').eq('id', alice.id).single()).data?.wc_team_flair).toBe('Argentina');
  });
});

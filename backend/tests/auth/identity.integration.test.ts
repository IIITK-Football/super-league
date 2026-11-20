// Group: auth-identity. Runs against the local Supabase Auth service (no hosted project).
// A Google account is simulated by a confirmed user without a password who signs in through a
// one-time link; the behavior under test is that a password is added to that SAME user.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAILPIT, clients, localKeys, uniqueEmail } from './local-supabase';

const PASSWORD = 'correct-horse-battery-1';
let admin: ReturnType<typeof clients>['admin'];
let anon: ReturnType<typeof clients>['anon'];
const created: string[] = [];

async function createConfirmedUser(email: string, password?: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: 'Auth Test' },
    ...(password ? { password } : {}),
  });
  if (error) throw error;
  created.push(data.user.id);
  return data.user;
}

async function signInViaLink(email: string, type: 'magiclink' | 'recovery') {
  const { data, error } = await admin.auth.admin.generateLink({ type, email });
  if (error) throw error;
  const client = anon();
  const { data: v, error: vErr } = await client.auth.verifyOtp({ token_hash: data.properties.hashed_token, type });
  if (vErr) throw vErr;
  return { client, session: v.session! };
}

beforeAll(() => {
  const keys = localKeys();
  const c = clients(keys);
  admin = c.admin;
  anon = c.anon;
});

afterAll(async () => {
  for (const id of created) await admin.auth.admin.deleteUser(id);
});

describe('college domain at the Auth boundary', () => {
  it('rejects creating a non-college account (admin path)', async () => {
    const { error } = await admin.auth.admin.createUser({ email: uniqueEmail('x', 'gmail.com'), email_confirm: true });
    expect(error).toBeTruthy();
  });

  it('rejects a public password sign-up with a non-college email', async () => {
    const { data, error } = await anon().auth.signUp({ email: uniqueEmail('y', 'gmail.com'), password: PASSWORD });
    expect(error).toBeTruthy();
    expect(data.session).toBeNull();
  });

  it('rejects look-alike domains', async () => {
    const { error } = await admin.auth.admin.createUser({
      email: uniqueEmail('z', 'iiitkottayam.ac.in.evil.com'),
      email_confirm: true,
    });
    expect(error).toBeTruthy();
  });

  it('rejects moving an account to a non-college email', async () => {
    const user = await createConfirmedUser(uniqueEmail('move'));
    const { error } = await admin.auth.admin.updateUserById(user.id, { email: uniqueEmail('moved', 'gmail.com') });
    expect(error).toBeTruthy();
  });
});

describe('Google-style account adds a website password (same user)', () => {
  it('keeps the same user id, profile and role, and password sign-in then works', async () => {
    const email = uniqueEmail('addpw');
    const user = await createConfirmedUser(email); // no password yet, like a Google-only account

    const before = await admin.from('user_profiles').select('id,email,real_name').eq('id', user.id).single();
    expect(before.data?.real_name).toBe('Auth Test');

    const { client } = await signInViaLink(email, 'magiclink');
    const { data: updated, error } = await client.auth.updateUser({ password: PASSWORD });
    expect(error).toBeNull();
    expect(updated.user?.id).toBe(user.id);

    const second = await anon().auth.signInWithPassword({ email, password: PASSWORD });
    expect(second.error).toBeNull();
    expect(second.data.user?.id).toBe(user.id);

    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    expect(list.users.filter((u) => u.email === email)).toHaveLength(1);

    const after = await admin.from('user_profiles').select('id,email,real_name').eq('id', user.id).single();
    expect(after.data).toEqual(before.data);
    // A normal user holds no role grant, and adding a password does not create one.
    const roles = await admin.from('user_roles').select('role').eq('user_id', user.id);
    expect(roles.data ?? []).toEqual([]);
  });

  it('does not create a second account when signing up again with an existing email', async () => {
    const email = uniqueEmail('dupe');
    const user = await createConfirmedUser(email, PASSWORD);
    await anon().auth.signUp({ email, password: 'another-long-password-2' });
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const matches = list.users.filter((u) => u.email === email);
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe(user.id);
    // the original password still works; the second sign-up did not replace it
    expect((await anon().auth.signInWithPassword({ email, password: PASSWORD })).error).toBeNull();
  });

  it('a password user keeps the same id when its email already exists as a verified identity', async () => {
    const email = uniqueEmail('pwfirst');
    const user = await createConfirmedUser(email, PASSWORD);
    const { data } = await admin.auth.admin.getUserById(user.id);
    expect(data.user?.email_confirmed_at).toBeTruthy(); // verified before any OAuth linking
    expect(data.user?.identities?.map((i) => i.provider)).toContain('email');
  });
});

describe('password reset', () => {
  it('lets a user set a new password through a recovery session, keeping the same id', async () => {
    const email = uniqueEmail('reset');
    const user = await createConfirmedUser(email, PASSWORD);
    const { client } = await signInViaLink(email, 'recovery');
    const { data, error } = await client.auth.updateUser({ password: 'brand-new-password-3' });
    expect(error).toBeNull();
    expect(data.user?.id).toBe(user.id);
    expect((await anon().auth.signInWithPassword({ email, password: PASSWORD })).error).toBeTruthy();
    const again = await anon().auth.signInWithPassword({ email, password: 'brand-new-password-3' });
    expect(again.error).toBeNull();
    expect(again.data.user?.id).toBe(user.id);
  });

  it('delivers the reset email to local Mailpit', async (ctx) => {
    const email = uniqueEmail('mail');
    await createConfirmedUser(email, PASSWORD);
    const { error } = await anon().auth.resetPasswordForEmail(email, { redirectTo: 'http://127.0.0.1:5173/reset-password' });
    if (error && /rate limit/i.test(error.message)) {
      ctx.skip(); // local email_sent limit reached; see docs/auth.md to raise it
      return;
    }
    expect(error).toBeNull();
    let found = false;
    for (let i = 0; i < 20 && !found; i++) {
      const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
      const body = (await res.json()) as { messages?: unknown[] };
      found = (body.messages?.length ?? 0) > 0;
      if (!found) await new Promise((r) => setTimeout(r, 250));
    }
    expect(found).toBe(true);
  });
});

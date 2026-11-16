// Group: auth-identity. A real Google account has ONLY a `google` identity (no `email` identity).
// This converts a local test user to that shape (SQL on the local database at 127.0.0.1:54322
// only) and checks that adding a website password keeps the same user and that password
// sign-in then works. Actual Google OAuth needs developer credentials and is not exercised.
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clients, localKeys, uniqueEmail } from './local-supabase';

const PASSWORD = 'correct-horse-battery-1';
const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
let admin: ReturnType<typeof clients>['admin'];
let anon: ReturnType<typeof clients>['anon'];
const created: string[] = [];

function localSql(sql: string) {
  const r = spawnSync('psql', [LOCAL_DB, '-v', 'ON_ERROR_STOP=1', '-Atc', sql], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`local SQL failed: ${r.stderr}`);
  return r.stdout.trim();
}

async function createGoogleOnlyUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: 'Google Only' },
  });
  if (error) throw error;
  const id = data.user.id;
  created.push(id);
  // Same shape Supabase stores after "Sign in with Google": a google identity, no email identity.
  localSql(`
    delete from auth.identities where user_id = '${id}';
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values ('google-${id}', '${id}',
              jsonb_build_object('sub', 'google-${id}', 'email', '${email}', 'email_verified', true),
              'google', now(), now(), now());
    update auth.users set raw_app_meta_data = '{"provider":"google","providers":["google"]}'::jsonb where id = '${id}';
  `);
  return id;
}

// A signed-in session for the account, standing in for the session Google sign-in would create.
async function sessionFor(email: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;
  const client = anon();
  const { error: vErr } = await client.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' });
  if (vErr) throw vErr;
  return client;
}

beforeAll(() => {
  const c = clients(localKeys());
  admin = c.admin;
  anon = c.anon;
});

afterAll(async () => {
  for (const id of created) await admin.auth.admin.deleteUser(id);
});

describe('Google-only account (no email identity)', () => {
  it('really has only a google identity before the password is added', async () => {
    const email = uniqueEmail('gonly1');
    const id = await createGoogleOnlyUser(email);
    const { data } = await admin.auth.admin.getUserById(id);
    expect(data.user?.identities?.map((i) => i.provider)).toEqual(['google']);
    expect((await anon().auth.signInWithPassword({ email, password: PASSWORD })).error).toBeTruthy(); // no password yet
  });

  it('can add a website password on the same user and then sign in with it', async () => {
    const email = uniqueEmail('gonly2');
    const id = await createGoogleOnlyUser(email);
    const before = await admin.from('user_profiles').select('id,email,real_name').eq('id', id).single();

    const client = await sessionFor(email);
    const { data: updated, error } = await client.auth.updateUser({ password: PASSWORD });
    expect(error).toBeNull();
    expect(updated.user?.id).toBe(id);

    const login = await anon().auth.signInWithPassword({ email, password: PASSWORD });
    expect(login.error).toBeNull();
    expect(login.data.user?.id).toBe(id);

    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    expect(list.users.filter((u) => u.email === email)).toHaveLength(1);

    const after = await admin.from('user_profiles').select('id,email,real_name').eq('id', id).single();
    expect(after.data).toEqual(before.data);
    const role = await admin.from('user_roles').select('role').eq('user_id', id).single();
    expect(role.data?.role).toBe('default');
  });

  it('keeps the google identity after the password is added', async () => {
    const email = uniqueEmail('gonly3');
    const id = await createGoogleOnlyUser(email);
    const client = await sessionFor(email);
    expect((await client.auth.updateUser({ password: PASSWORD })).error).toBeNull();
    const { data } = await admin.auth.admin.getUserById(id);
    expect(data.user?.identities?.map((i) => i.provider)).toContain('google');
  });

  it('can reset the password through the email link for a Google-only account', async () => {
    const email = uniqueEmail('gonly4');
    const id = await createGoogleOnlyUser(email);
    const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
    expect(error).toBeNull();
    const client = anon();
    expect((await client.auth.verifyOtp({ token_hash: data.properties!.hashed_token, type: 'recovery' })).error).toBeNull();
    expect((await client.auth.updateUser({ password: PASSWORD })).error).toBeNull();
    const login = await anon().auth.signInWithPassword({ email, password: PASSWORD });
    expect(login.data.user?.id).toBe(id);
  });
});

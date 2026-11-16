// Group: auth-identity. "Secure password change" on the LOCAL Auth service: a session older than
// 24 hours must supply an emailed one-time code to change the password. The test ages one of its
// own test sessions in the local database (127.0.0.1:54322). Needs secure_password_change = true
// in supabase/config.toml, which applies after the stack is restarted.
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAILPIT, clients, localKeys, uniqueEmail } from './local-supabase';

const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
let c: ReturnType<typeof clients>;
const created: string[] = [];

function localSql(sql: string) {
  const r = spawnSync('psql', [LOCAL_DB, '-v', 'ON_ERROR_STOP=1', '-Atc', sql], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`local SQL failed: ${r.stderr}`);
}

async function signedInUser(label: string) {
  const email = uniqueEmail(label);
  const { data, error } = await c.admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  created.push(data.user.id);
  const link = await c.admin.auth.admin.generateLink({ type: 'magiclink', email });
  const client = c.anon();
  const { error: vErr } = await client.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'magiclink' });
  if (vErr) throw vErr;
  return { id: data.user.id, email, client };
}

const ageSession = (id: string) => localSql(`update auth.sessions set created_at = now() - interval '2 days' where user_id = '${id}'`);

async function emailedCode(email: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const search = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as {
      messages?: { ID: string }[];
    };
    const id = search.messages?.[0]?.ID;
    if (id) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Text?: string; HTML?: string };
      const m = `${msg.Text ?? ''} ${msg.HTML ?? ''}`.match(/\b(\d{6})\b/);
      if (m) return m[1];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('no reauthentication code arrived in local Mailpit');
}

beforeAll(() => {
  c = clients(localKeys());
});
afterAll(async () => {
  for (const id of created) await c.admin.auth.admin.deleteUser(id);
});

describe('password change reauthentication (local Auth)', () => {
  it('lets a recently signed-in session change the password without a code', async () => {
    const u = await signedInUser('reauthfresh');
    expect((await u.client.auth.updateUser({ password: 'correct-horse-battery-1' })).error).toBeNull();
  });

  it('asks an older session for a code instead of changing the password', async (ctx) => {
    const u = await signedInUser('reauthold');
    ageSession(u.id);
    const { error } = await u.client.auth.updateUser({ password: 'correct-horse-battery-1' });
    if (!error) {
      const hint = 'secure_password_change is not active on the running local Auth service: restart it with pnpm db:stop && pnpm db:start';
      if (process.env.CI) throw new Error(hint);
      ctx.skip(hint);
      return;
    }
    expect(error.message).toMatch(/reauthentication/i);
    // and the old password state is unchanged: password sign-in still fails
    expect((await c.anon().auth.signInWithPassword({ email: u.email, password: 'correct-horse-battery-1' })).error).toBeTruthy();
  });

  it('changes the password with the emailed code, keeping the same user', async (ctx) => {
    const u = await signedInUser('reauthcode');
    ageSession(u.id);
    const first = await u.client.auth.updateUser({ password: 'correct-horse-battery-2' });
    if (!first.error) {
      const hint = 'secure_password_change is not active on the running local Auth service: restart it with pnpm db:stop && pnpm db:start';
      if (process.env.CI) throw new Error(hint);
      ctx.skip(hint);
      return;
    }
    expect((await u.client.auth.reauthenticate()).error).toBeNull();
    const code = await emailedCode(u.email);

    const wrong = await u.client.auth.updateUser({ password: 'correct-horse-battery-2', nonce: code === '000000' ? '111111' : '000000' });
    expect(wrong.error).toBeTruthy();

    const ok = await u.client.auth.updateUser({ password: 'correct-horse-battery-2', nonce: code });
    expect(ok.error).toBeNull();
    expect(ok.data.user?.id).toBe(u.id);
    const login = await c.anon().auth.signInWithPassword({ email: u.email, password: 'correct-horse-battery-2' });
    expect(login.error).toBeNull();
    expect(login.data.user?.id).toBe(u.id);
  });
});

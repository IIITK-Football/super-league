// Group: api-services. Publishing an article through the Worker stores the publisher's public display name as the
// byline (nickname, then real name, then "Super League Editorial"), never their email address or account id.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { clients, localKeys, uniqueEmail } from '../../backend/tests/auth/local-supabase';

const keys = localKeys();
const admin = clients(keys).admin;
let app: ReturnType<typeof createApp>;
const users: string[] = [];
const titles: string[] = [];

async function editor(nickname: string | null) {
  const email = uniqueEmail('byline');
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  users.push(data.user.id);
  await admin.from('user_roles').insert({ user_id: data.user.id, role: 'editor' });
  await admin.from('user_profiles').upsert({ id: data.user.id, email, nickname, real_name: null });
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const v = await clients(keys).anon().auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'magiclink' });
  if (v.error) throw v.error;
  return { id: data.user.id, email, token: v.data.session!.access_token };
}

async function publish(token: string, title: string) {
  titles.push(title);
  const res = await app.request('http://localhost/api/admin/newsletter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title, summary: 's', content: [], category: 'Official Editorial' }),
  });
  return { status: res.status, body: await res.json() };
}

beforeAll(() => {
  Object.assign(process.env, { SUPABASE_URL: keys.url, SUPABASE_PUBLISHABLE_KEY: keys.publishable, SUPABASE_SECRET_KEY: keys.secret, SL_ENVIRONMENT: 'local' });
  app = createApp();
});
afterAll(async () => {
  if (titles.length) await admin.from('newsletter').delete().in('title', titles);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 30000);

describe('article bylines', () => {
  it("uses the publisher's nickname, never their email", async () => {
    const e = await editor('Byline Nick');
    const r = await publish(e.token, `byline-${Date.now()}-a`);
    expect(r.status).toBe(200);
    expect(r.body.data.author).toBe('Byline Nick');
    expect(JSON.stringify(r.body)).not.toContain(e.email);
  });

  it('falls back to the editorial byline without a display name, never the account id', async () => {
    const e = await editor(null);
    const r = await publish(e.token, `byline-${Date.now()}-b`);
    expect(r.status).toBe(200);
    expect(r.body.data.author).toBe('Super League Editorial');
    expect(JSON.stringify(r.body)).not.toContain(e.id);
  });
});

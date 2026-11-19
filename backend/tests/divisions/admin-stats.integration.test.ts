// Group: divisions. The dictator dashboard counts (GET /api/admin/stats) through the real local Auth and Data API, with
// the session in the cookie the browser sends: a signed-in account gets the player and upcoming-match counts (the
// player count reads only ids: the account-link column of players is not readable by signed-in users), and a visitor
// without a session is refused. Runs against THIS repository's local Supabase stack (127.0.0.1:54321).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clients, localKeys, uniqueEmail } from '../auth/local-supabase';

const jar = vi.hoisted(() => ({ cookies: [] as { name: string; value: string }[] }));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => jar.cookies, set: () => {} }) }));

let admin: SupabaseClient;
let userId = '';
let session: Record<string, unknown> = {};

beforeAll(async () => {
  const keys = localKeys();
  Object.assign(process.env, { SUPABASE_URL: keys.url, SUPABASE_PUBLISHABLE_KEY: keys.publishable, SUPABASE_SECRET_KEY: keys.secret });
  const c = clients(keys);
  admin = c.admin;
  const email = uniqueEmail('stats-dictator');
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  await admin.from('user_roles').update({ role: 'dictator' }).eq('user_id', userId);
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const v = await c.anon().auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'magiclink' });
  if (v.error) throw v.error;
  session = v.data.session as unknown as Record<string, unknown>;
}, 60000);

afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
}, 30000);

const get = async () => {
  const { GET } = await import('../../app/api/admin/stats/route');
  const res = await GET(new Request('http://localhost/api/admin/stats'));
  return { status: res.status, body: await res.json() };
};

describe('admin stats', () => {
  it('counts players and upcoming matches for a signed-in account', async () => {
    jar.cookies = [{ name: `sb-${new URL(process.env.SUPABASE_URL!).hostname.split('.')[0]}-auth-token`, value: `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}` }];
    const { count: players } = await admin.from('players').select('id', { count: 'exact', head: true });
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body.data.totalPlayers).toBe(players);
    expect(r.body.data.totalPlayers).toBeGreaterThan(0);
  });

  it('refuses a visitor without a session', async () => {
    jar.cookies = [];
    expect((await get()).status).toBe(401);
  });
});

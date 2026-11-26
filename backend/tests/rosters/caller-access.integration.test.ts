// Group: rosters. The caller helpers the roster and portrait routes use (lib/roster/access.ts) build the caller's own
// client through the shared factories (D-04): the request's bearer token reaches the Data API, so row level security
// and role checks see the caller; without a token the helper answers 401 before any roster read.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clients, localKeys, uniqueEmail } from '../auth/local-supabase';
import { callerClient, isResponse, requireUser } from '../../lib/roster/access';

let admin: SupabaseClient;
const made: { id: string; token: string }[] = [];

async function account(roles: string[] = []) {
  const keys = localKeys();
  const email = uniqueEmail('roster-caller');
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  for (const role of roles) await admin.from('user_roles').insert({ user_id: data.user.id, role });
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const v = await clients(keys).anon().auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'magiclink' });
  if (v.error) throw v.error;
  const user = { id: data.user.id, token: v.data.session!.access_token };
  made.push(user);
  return user;
}

const request = (token?: string) => new Request('http://localhost/api/profile/player-portrait', { headers: token ? { Authorization: `Bearer ${token}` } : {} });

beforeAll(() => {
  const keys = localKeys();
  Object.assign(process.env, { SUPABASE_URL: keys.url, SUPABASE_PUBLISHABLE_KEY: keys.publishable, SUPABASE_SECRET_KEY: keys.secret });
  admin = clients(keys).admin;
});
afterAll(async () => {
  for (const u of made) await admin.auth.admin.deleteUser(u.id);
}, 30000);

describe('roster caller access', () => {
  it('identifies the caller from their token and queries as them', async () => {
    const captain = await account(['captain']);
    const caller = await requireUser(request(captain.token));
    expect(isResponse(caller)).toBe(false);
    if (isResponse(caller)) return;
    expect(caller.user.id).toBe(captain.id);
    const { data: roles } = await caller.supabase.rpc('my_roles');
    expect(roles).toEqual(['captain']);
  });

  it('answers 401 without a token, and an anonymous client holds no roles', async () => {
    const refused = await requireUser(request());
    expect(isResponse(refused) && refused.status).toBe(401);
    const { data: roles } = await (await callerClient(request())).rpc('my_roles');
    expect(roles ?? []).toEqual([]);
  });
});

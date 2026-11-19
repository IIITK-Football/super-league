// Group: player-accounts. Automatic linking when an account's email becomes verified, through the real local Auth
// (GoTrue) and database: a legacy player waiting for an email (a private match key) is linked when that account
// confirms its email (the confirmation link) or signs up already verified, and the link is audited as auto-link.
// Nothing is linked before verification, with no match or with several matching players, and no player is ever
// created; confirmation always succeeds. Concurrent confirmation and dictator links keep one player per account and
// one account per player. Legacy players and keys are written as the seed writes them (local only). Runs against THIS
// repository's local Supabase (127.0.0.1:54321).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clients, localKeys, uniqueEmail } from '../auth/local-supabase';
import { insertLocal } from '../local-fixtures';

const tag = `auto${Date.now().toString(36)}`;
let admin: SupabaseClient;
let c: ReturnType<typeof clients>;
const users: string[] = [];
const players: string[] = [];
let dictator: SupabaseClient;

const emailFor = (label: string) => uniqueEmail(`${tag}-${label}`).toLowerCase();
async function createAccount(email: string, verified: boolean) {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: verified });
  if (error) throw error;
  users.push(data.user.id);
  return data.user.id;
}
// The email confirmation a person completes: GoTrue verifies the one-time link and marks the email confirmed.
async function confirmByLink(email: string) {
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error) throw link.error;
  const v = await c.anon().auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'magiclink' });
  return v;
}
function legacy(label: string, key: string | null) {
  const p = insertLocal<{ id: string }>('players', [{ first_name: `${tag}${label}`, last_name: 'Legacy' }])[0].id;
  players.push(p);
  if (key) insertLocal('player_link_keys', [{ player_id: p, email: key }]);
  return p;
}
const linkOf = async (player: string) => (await admin.from('players').select('user_id').eq('id', player).single()).data!.user_id as string | null;
const confirmed = async (id: string) => Boolean((await admin.auth.admin.getUserById(id)).data.user?.email_confirmed_at);

beforeAll(async () => {
  const keys = localKeys();
  c = clients(keys);
  admin = c.admin;
  const email = emailFor('dictator');
  const id = await createAccount(email, true);
  await admin.from('user_roles').update({ role: 'dictator' }).eq('user_id', id);
  dictator = c.anon();
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const v = await dictator.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'magiclink' });
  if (v.error) throw v.error;
}, 60000);

afterAll(async () => {
  if (!admin) return;
  if (players.length) await admin.from('players').delete().in('id', players);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 60000);

describe('automatic link on verification', () => {
  it('links the waiting player when the account confirms its email, not before, and audits it as auto-link', async () => {
    const email = emailFor('confirm');
    const player = legacy('Confirm', email);
    const account = await createAccount(email, false);
    expect(await linkOf(player)).toBeNull();
    const v = await confirmByLink(email);
    expect(v.error).toBeNull();
    expect(await confirmed(account)).toBe(true);
    expect(await linkOf(player)).toBe(account);
    const { data: audit } = await admin.from('audit_log').select('actor_id, actor_role, changes').eq('table_name', 'players').eq('record_id', player).order('id', { ascending: false }).limit(1);
    expect(audit![0]).toMatchObject({ actor_id: null, actor_role: 'auto-link', changes: { user_id: { from: null, to: account } } });
    expect(JSON.stringify(audit)).not.toContain('@');
  });

  it('links a sign-up that arrives already verified (as with Google)', async () => {
    const email = emailFor('google');
    const player = legacy('Google', email);
    const account = await createAccount(email, true);
    expect(await linkOf(player)).toBe(account);
  });

  it('links nothing when several players wait for the email, or none does, and never creates a player', async () => {
    const email = emailFor('shared');
    const one = legacy('SharedOne', email);
    const two = legacy('SharedTwo', email);
    const before = (await admin.from('players').select('id', { count: 'exact', head: true })).count;
    const shared = await createAccount(email, false);
    expect((await confirmByLink(email)).error).toBeNull();
    expect(await confirmed(shared)).toBe(true);
    expect([await linkOf(one), await linkOf(two)]).toEqual([null, null]);
    const lonely = await createAccount(emailFor('lonely'), true);
    expect((await admin.from('players').select('id', { count: 'exact', head: true })).count).toBe(before);
    expect((await admin.from('players').select('id').eq('user_id', lonely)).data ?? []).toEqual([]);
    const preview = (await dictator.rpc('account_link_matches')).data as { player_id: string; status: string; user_id: string }[];
    expect(preview.filter((m) => m.player_id === one || m.player_id === two)).toEqual([
      expect.objectContaining({ status: 'duplicate', user_id: shared }), expect.objectContaining({ status: 'duplicate', user_id: shared }),
    ]);
  });

  it('a confirmation racing a dictator\'s manual link leaves exactly one account on the player', async () => {
    const email = emailFor('race');
    const player = legacy('Race', email);
    const racer = await createAccount(email, false);
    const manual = await createAccount(emailFor('manual'), true);
    const [v, link] = await Promise.all([confirmByLink(email), dictator.rpc('link_player_account', { p_player: player, p_user: manual })]);
    expect(v.error).toBeNull(); // the confirmation is never blocked
    expect(await confirmed(racer)).toBe(true);
    const owner = await linkOf(player);
    expect([racer, manual]).toContain(owner);
    if (owner === racer) expect(link.error?.code).toBe('23505');
    else expect(link.error).toBeNull();
    expect((await admin.from('players').select('id').in('user_id', [racer, manual])).data).toHaveLength(1);
  });

  it('two dictator links of one account to two players at once: exactly one succeeds', async () => {
    const a = legacy('PairA', null);
    const b = legacy('PairB', null);
    const account = await createAccount(emailFor('pair'), true);
    const results = await Promise.all([a, b].map((p) => dictator.rpc('link_player_account', { p_player: p, p_user: account })));
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.find((r) => r.error)?.error?.code).toBe('23505');
    expect((await admin.from('players').select('id').eq('user_id', account)).data).toHaveLength(1);
  });
});

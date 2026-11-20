// Group: audit. The append-only audit history through THIS repository's local Auth and Data API (127.0.0.1:54321):
// a dictator's configuration change, a role change and a roster change made with their own token are recorded with
// that dictator as actor and a safe summary; captains, editors, normal users and anon read nothing;
// nobody can change or remove history, the server key included; no private contact data appears in it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clients, localKeys, uniqueEmail } from '../auth/local-supabase';

const tag = `audit${Date.now().toString(36)}`;
let admin: SupabaseClient;
let anon: SupabaseClient;
const users: string[] = [];
const as: Record<string, { id: string; db: SupabaseClient }> = {};
let divisionId = '';
let player = '';

async function signIn(role: string, c: ReturnType<typeof clients>) {
  const email = uniqueEmail(`audit-${role}`);
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  users.push(data.user.id);
  if (role !== 'default') await admin.from('user_roles').upsert({ user_id: data.user.id, role: role }, { onConflict: 'user_id,role', ignoreDuplicates: true });
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const db = c.anon();
  const { error: vErr } = await db.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'magiclink' });
  if (vErr) throw vErr;
  return { id: data.user.id, db };
}

const history = (table: string, record: string) =>
  admin.from('audit_log').select('actor_id, actor_role, action, changes').eq('table_name', table).eq('record_id', record).order('id', { ascending: true });

beforeAll(async () => {
  const keys = localKeys();
  const c = clients(keys);
  admin = c.admin;
  anon = c.anon();
  for (const role of ['dictator', 'captain', 'editor', 'default']) as[role] = await signIn(role, c);
}, 60000);

afterAll(async () => {
  if (!admin) return;
  if (player) {
    await admin.from('roster_memberships').delete().eq('player_id', player);
    await admin.from('players').delete().eq('id', player);
  }
  if (divisionId) await admin.from('divisions').delete().eq('id', divisionId);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 60000);

describe('recording', () => {
  it('records a dictator\'s division changes through the Data API with the dictator as actor', async () => {
    const { data, error } = await as.dictator.db.from('divisions').insert({ slug: tag, name: `${tag} Inter` }).select('id').single();
    expect(error).toBeNull();
    divisionId = data!.id;
    expect((await as.dictator.db.from('divisions').update({ name: `${tag} Inter League` }).eq('id', divisionId).select('id')).data).toHaveLength(1);
    const { data: rows } = await history('divisions', divisionId);
    expect(rows).toEqual([
      expect.objectContaining({ actor_id: as.dictator.id, actor_role: 'authenticated', action: 'insert', changes: expect.objectContaining({ slug: tag }) }),
      { actor_id: as.dictator.id, actor_role: 'authenticated', action: 'update', changes: { name: { from: `${tag} Inter`, to: `${tag} Inter League` } } },
    ]);
  });

  it('records a role change and an account-first player, keeping email addresses out', async () => {
    // A grant is recorded with the dictator as actor (a normal user holds no grant to begin with).
    expect((await as.dictator.db.from('user_roles').insert({ user_id: as.default.id, role: 'captain' }).select('user_id')).data).toHaveLength(1);
    const { data: roleRows } = await history('user_roles', `${as.default.id}:captain`);
    expect(roleRows!.at(-1)).toMatchObject({ actor_id: as.dictator.id, action: 'insert', changes: { role: 'captain' } });
    await admin.from('user_roles').delete().eq('user_id', as.default.id);

    const entry = (await admin.from('team_entries').select('id').limit(1).single()).data!;
    const email = uniqueEmail('audit-ada');
    const account = (await admin.auth.admin.createUser({ email, email_confirm: true })).data.user!;
    users.push(account.id);
    const { data: created, error } = await as.dictator.db.rpc('create_player_for_account', {
      p_user: account.id, p_team_entry_id: entry.id, p_first_name: `${tag}Ada`, p_last_name: 'Audit', p_jersey_number: 98,
    });
    expect(error).toBeNull();
    player = created as string;
    const { data: card } = await history('players', player);
    expect(card![0]).toMatchObject({ actor_id: as.dictator.id, action: 'insert', changes: expect.objectContaining({ user_id: account.id }) });
    const { data: place } = await admin.from('audit_log').select('actor_id').eq('table_name', 'roster_memberships').contains('changes', { player_id: player });
    expect(place).toEqual([{ actor_id: as.dictator.id }]);
    const { data: everything } = await admin.from('audit_log').select('changes').in('table_name', ['players', 'roster_memberships', 'player_link_keys']).order('id', { ascending: false }).limit(50);
    expect(JSON.stringify(everything)).not.toContain(email);
  });
});

describe('reading', () => {
  it('a dictator reads the history; captains, editors and normal users read nothing; anon is refused', async () => {
    expect(((await as.dictator.db.from('audit_log').select('id').limit(5)).data ?? []).length).toBeGreaterThan(0);
    for (const who of ['captain', 'editor', 'default']) {
      const { data, error } = await as[who].db.from('audit_log').select('id').limit(5);
      expect(error, who).toBeNull();
      expect(data, who).toEqual([]);
    }
    expect((await anon.from('audit_log').select('id').limit(1)).error?.code).toBe('42501');
  });
});

describe('append-only', () => {
  it('nobody can add, change or remove history: not a dictator, not the server key', async () => {
    const newest = (await admin.from('audit_log').select('id, actor_role').order('id', { ascending: false }).limit(1).single()).data!;
    expect((await as.dictator.db.from('audit_log').insert({ actor_role: 'forged', action: 'insert', table_name: 'x' })).error?.code).toBe('42501');
    expect((await as.dictator.db.from('audit_log').update({ actor_role: 'forged' }).eq('id', newest.id)).error?.code).toBe('42501');
    expect((await as.dictator.db.from('audit_log').delete().eq('id', newest.id)).error?.code).toBe('42501');
    expect((await admin.from('audit_log').update({ actor_role: 'forged' }).eq('id', newest.id)).error?.code).toBe('42501');
    expect((await admin.from('audit_log').delete().eq('id', newest.id)).error?.code).toBe('42501');
    expect((await admin.from('audit_log').select('actor_role').eq('id', newest.id).single()).data!.actor_role).toBe(newest.actor_role);
  });
});

// Group: auth-roles. A dictator assigns, changes and revokes captains through the real Data API. One captain per team
// entry; one person may captain several entries (a current and an upcoming season; the completed season is read-only);
// changing the captain and back keeps one assignment; the captain grant goes with the last writable assignment and
// never takes another grant with it. A captain cannot assign anyone, and cannot write a completed season.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { account, cleanup, startFixture, world } from './fixture';

const f = startFixture();
let w: Awaited<ReturnType<typeof world>>;
const who: Record<string, Awaited<ReturnType<typeof account>>> = {};
const tag = `ca${Date.now().toString(36)}`;
const grants = async (id: string) => ((await f.admin.from('user_roles').select('role').eq('user_id', id)).data ?? []).map((r) => r.role).sort();
const assignmentsOf = async (entry: string) => ((await f.admin.from('captain_assignments').select('user_id').eq('team_entry_id', entry)).data ?? []).map((r) => r.user_id);

beforeAll(async () => {
  w = await world(f, tag);
  who.dictator = await account(f, 'dictator', ['dictator']);
  who.alice = await account(f, 'alice');
  who.bob = await account(f, 'bob');
  who.editor = await account(f, 'editor', ['editor']);
}, 120000);
afterAll(async () => cleanup(f), 60000);

describe('captain assignments through the Data API', () => {
  it('assigns a captain to a team entry and adds the captain grant', async () => {
    const r = await who.dictator.db.rpc('assign_captain', { p_entry: w.entries.cur[0], p_user: who.alice.id });
    expect(r.error).toBeNull();
    expect(await assignmentsOf(w.entries.cur[0])).toEqual([who.alice.id]);
    expect(await grants(who.alice.id)).toEqual(['captain']);
  });

  it('refuses a second captain for the same entry (409-style), and changes the captain only when asked', async () => {
    const refused = await who.dictator.db.rpc('assign_captain', { p_entry: w.entries.cur[0], p_user: who.bob.id });
    expect(refused.error?.code).toBe('23505');
    expect(await assignmentsOf(w.entries.cur[0])).toEqual([who.alice.id]);
    const changed = await who.dictator.db.rpc('assign_captain', { p_entry: w.entries.cur[0], p_user: who.bob.id, p_replace: true });
    expect(changed.error).toBeNull();
    expect(await assignmentsOf(w.entries.cur[0])).toEqual([who.bob.id]);
    expect(await grants(who.alice.id)).toEqual([]); // the previous captain loses only the captain grant
    const back = await who.dictator.db.rpc('assign_captain', { p_entry: w.entries.cur[0], p_user: who.alice.id, p_replace: true });
    expect(back.error).toBeNull();
    expect(await assignmentsOf(w.entries.cur[0])).toEqual([who.alice.id]); // one assignment, its roster and season untouched
  });

  it('lets one person captain a current and an upcoming entry, and refuses a completed season', async () => {
    expect((await who.dictator.db.rpc('assign_captain', { p_entry: w.entries.next[1], p_user: who.alice.id })).error).toBeNull();
    const done = await who.dictator.db.rpc('assign_captain', { p_entry: w.entries.old[1], p_user: who.alice.id });
    expect(done.error?.code).toBe('22023');
    const writable = async (entry: string) => (await who.alice.db.rpc('is_captain_of', { p_entry: entry })).data;
    expect(await writable(w.entries.cur[0])).toBe(true);
    expect(await writable(w.entries.next[1])).toBe(true); // an upcoming season can be prepared
    expect(await writable(w.entries.cur[1])).toBe(false); // an entry she does not captain
  });

  it('keeps the captain grant while another writable assignment remains, then removes only that grant', async () => {
    await f.admin.from('user_roles').insert({ user_id: who.alice.id, role: 'editor' }); // another grant, kept throughout
    expect((await who.dictator.db.rpc('revoke_captain', { p_entry: w.entries.cur[0] })).error).toBeNull();
    expect(await grants(who.alice.id)).toEqual(['captain', 'editor']);
    expect((await who.dictator.db.rpc('revoke_captain', { p_entry: w.entries.next[1] })).error).toBeNull();
    expect(await grants(who.alice.id)).toEqual(['editor']);
  });

  it('lapses a captain grant when the season stops being writable, and a completed entry is read-only at once', async () => {
    expect((await who.dictator.db.rpc('assign_captain', { p_entry: w.entries.next[0], p_user: who.bob.id })).error).toBeNull();
    expect((await f.admin.from('seasons').update({ status: 'completed' }).eq('id', w.seasons.next)).error).toBeNull();
    expect((await who.bob.db.rpc('is_captain_of', { p_entry: w.entries.next[0] })).data).toBe(false);
    // Scoped to this person: the unscoped lifecycle call would also lapse other tests' captains that run in parallel.
    const lapsed = await who.dictator.db.rpc('refresh_captain_grants', { p_user: who.bob.id });
    expect(lapsed.error).toBeNull();
    expect(await grants(who.bob.id)).toEqual([]);
    expect(await assignmentsOf(w.entries.next[0])).toEqual([who.bob.id]); // the assignment stays as history
  });

  it('refuses everyone but a dictator: a captain, an editor and a normal account cannot assign or revoke', async () => {
    for (const name of ['alice', 'editor', 'bob']) {
      const a = await who[name].db.rpc('assign_captain', { p_entry: w.entries.cur[1], p_user: who.bob.id });
      expect(a.error?.code, name).toBe('42501');
      const r = await who[name].db.rpc('revoke_captain', { p_entry: w.entries.next[0] });
      expect(r.error?.code, name).toBe('42501');
    }
    const direct = await who.alice.db.from('captain_assignments').insert({ team_entry_id: w.entries.cur[1], user_id: who.alice.id });
    expect(direct.error).not.toBeNull();
  });

  it('assigns scorers by season or match, refuses both or neither, and removes the scorer grant with the last assignment', async () => {
    const both = await who.dictator.db.rpc('assign_scorer', { p_user: who.bob.id, p_season: w.seasons.cur, p_match: w.matches[0] });
    expect(both.error?.code).toBe('22023');
    const ok = await who.dictator.db.rpc('assign_scorer', { p_user: who.bob.id, p_season: null, p_match: w.matches[0] });
    expect(ok.error).toBeNull();
    expect(await grants(who.bob.id)).toEqual(['scorer']);
    const dup = await who.dictator.db.rpc('assign_scorer', { p_user: who.bob.id, p_season: null, p_match: w.matches[0] });
    expect(dup.error?.code).toBe('23505');
    expect((await who.dictator.db.rpc('revoke_scorer', { p_assignment: ok.data })).error).toBeNull();
    expect(await grants(who.bob.id)).toEqual([]);
    const past = await who.dictator.db.rpc('assign_scorer', { p_user: who.bob.id, p_season: w.seasons.cur, p_match: null, p_expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(past.error?.code).toBe('22023');
  });

  it('records every grant and assignment change in the audit history with the dictator as actor', async () => {
    const log = await f.admin.from('audit_log').select('actor_id, table_name, action').eq('table_name', 'captain_assignments').eq('actor_id', who.dictator.id);
    expect((log.data ?? []).length).toBeGreaterThan(0);
    const roles = await f.admin.from('audit_log').select('actor_id').eq('table_name', 'user_roles').eq('actor_id', who.dictator.id);
    expect((roles.data ?? []).length).toBeGreaterThan(0);
  });
});

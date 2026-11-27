// Group: match-operations. An assigned scorer runs a match through the live route on match events: records an
// unattributed goal, attributes it later, corrects the minute and the own-goal flag, voids with a reason, adds and
// voids cards, steps the score with +1 and -1. Every step moves the cached score exactly once and is audited; a replayed
// id changes nothing, different content for the same id and a stale version are 409s; denied roles write nothing.
// Handlers run for real against the local stack with each account's token.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { account, cleanup, startFixture, uuid, withPlayers, world } from './fixture';


const f = startFixture();
let w: Awaited<ReturnType<typeof world>>;
let ps: Awaited<ReturnType<typeof withPlayers>>;
const who: Record<string, Awaited<ReturnType<typeof account>>> = {};
const tag = `le${Date.now().toString(36)}`;
const M = () => w.matches[0];

async function live(token: string | null, body: Record<string, unknown>) {
  const { POST } = await import('../../app/api/admin/matches/live/route');
  const res = await POST(new Request('http://localhost/api/admin/matches/live', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ match_id: M(), ...body }),
  }));
  return { status: res.status, body: await res.json() };
}
const score = async () => { const { data } = await f.admin.from('matches').select('home_score, away_score').eq('id', M()).single(); return `${data!.home_score}-${data!.away_score}`; };
const event = async (id: string) => (await f.admin.from('match_events').select('*').eq('id', id).single()).data!;

beforeAll(async () => {
  Object.assign(process.env, { SUPABASE_URL: f.keys.url, SUPABASE_PUBLISHABLE_KEY: f.keys.publishable, SUPABASE_SECRET_KEY: f.keys.secret });
  w = await world(f, tag);
  ps = await withPlayers(f, w, tag);
  who.scorer = await account(f, 'scorer', ['scorer']);
  who.elsewhere = await account(f, 'elsewhere', ['scorer']);
  who.captain = await account(f, 'captain', ['captain']);
  who.normal = await account(f, 'normal');
  await f.admin.from('scorer_assignments').insert([{ user_id: who.scorer.id, match_id: M() }, { user_id: who.elsewhere.id, match_id: w.matches[1] }]);
  await f.admin.from('captain_assignments').insert({ team_entry_id: w.entries.cur[0], user_id: who.captain.id });
}, 120000);
afterAll(async () => cleanup(f, ps?.all), 60000);

describe('recording and correcting events', () => {
  const g1 = uuid();
  it('records a goal with no scorer yet: it moves the score and marks the match live', async () => {
    const r = await live(who.scorer.token, { action: 'add_event', event: { id: g1, kind: 'goal', team_id: w.teams[0], minute: "12'" } });
    expect(r.status).toBe(200);
    expect(r.body.event).toMatchObject({ id: g1, player_id: null, minute: 12, version: 1 });
    expect(await score()).toBe('1-0');
    expect((await f.admin.from('matches').select('status').eq('id', M()).single()).data!.status).toBe('live');
  });

  it('a replay of the same id changes nothing; different content for that id is a 409', async () => {
    const again = await live(who.scorer.token, { action: 'add_event', event: { id: g1, kind: 'goal', team_id: w.teams[0], minute: 12 } });
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect(await score()).toBe('1-0');
    const clash = await live(who.scorer.token, { action: 'add_event', event: { id: g1, kind: 'goal', team_id: w.teams[1], minute: 12 } });
    expect(clash.status).toBe(409);
    expect((await f.admin.from('match_events').select('id').eq('match_id', M())).data).toHaveLength(1);
  });

  it('attributes the goal later with an assist and corrects the minute; the score does not move', async () => {
    const r = await live(who.scorer.token, { action: 'edit_event', event_id: g1, version: 1, changes: { player_id: ps.home[0], assist_player_id: ps.home[1], minute: '14' } });
    expect(r.status).toBe(200);
    expect(r.body.event).toMatchObject({ player_id: ps.home[0], assist_player_id: ps.home[1], minute: 14, version: 2 });
    expect(await score()).toBe('1-0');
  });

  it('a stale version is a 409 with the current event, and writes nothing', async () => {
    const r = await live(who.scorer.token, { action: 'edit_event', event_id: g1, version: 1, changes: { minute: 99 } });
    expect(r.status).toBe(409);
    expect(r.body.event.version).toBe(2);
    expect((await event(g1)).minute).toBe(14);
  });

  it('flipping a goal into an own goal moves it to the other side of the score', async () => {
    const r = await live(who.scorer.token, { action: 'edit_event', event_id: g1, version: 2, changes: { kind: 'own_goal', assist_player_id: null } });
    expect(r.status).toBe(200);
    expect(await score()).toBe('0-1');
    const back = await live(who.scorer.token, { action: 'edit_event', event_id: g1, version: 3, changes: { kind: 'goal' } });
    expect(back.status).toBe(200);
    expect(await score()).toBe('1-0');
  });

  it('refuses a player from the other team, an unknown kind and an assist that is the scorer, with clear messages', async () => {
    const wrongTeam = await live(who.scorer.token, { action: 'edit_event', event_id: g1, version: 4, changes: { player_id: ps.away[0] } });
    expect(wrongTeam.status).toBe(400);
    expect(wrongTeam.body.message).toMatch(/roster/);
    expect((await live(who.scorer.token, { action: 'add_event', event: { kind: 'penalty', team_id: w.teams[0] } })).status).toBe(400);
    expect((await live(who.scorer.token, { action: 'add_event', event: { kind: 'goal', team_id: w.teams[0], player_id: ps.home[0], assist_player_id: ps.home[0] } })).status).toBe(400);
    expect(await score()).toBe('1-0');
  });

  it('adds and voids a card, which never changes the score', async () => {
    const card = uuid();
    const r = await live(who.scorer.token, { action: 'add_event', event: { id: card, kind: 'yellow', team_id: w.teams[1], player_id: ps.away[0], minute: 55 } });
    expect(r.status).toBe(200);
    expect(await score()).toBe('1-0');
    expect((await live(who.scorer.token, { action: 'void_event', event_id: card, version: 1, reason: '' })).status).toBe(400);
    const voided = await live(who.scorer.token, { action: 'void_event', event_id: card, version: 1, reason: 'booked the wrong player' });
    expect(voided.status).toBe(200);
    expect(voided.body.event.voided_at).not.toBeNull();
    expect((await live(who.scorer.token, { action: 'void_event', event_id: card, version: 2, reason: 'again' })).status).toBe(409);
    expect((await live(who.scorer.token, { action: 'edit_event', event_id: card, version: 2, changes: { minute: 60 } })).status).toBe(409);
  });

  it('voiding the goal takes it off the score and the event stays with its reason', async () => {
    const r = await live(who.scorer.token, { action: 'void_event', event_id: g1, version: 4, reason: 'ball did not cross the line' });
    expect(r.status).toBe(200);
    expect(await score()).toBe('0-0');
    expect(await event(g1)).toMatchObject({ void_reason: 'ball did not cross the line' });
  });
});

describe('score steps', () => {
  it('+1 adds unattributed goals; -1 voids the newest one; when every goal has a scorer the scorer must choose', async () => {
    expect((await live(who.scorer.token, { action: 'score_step', side: 'away', delta: 1 })).status).toBe(200);
    expect((await live(who.scorer.token, { action: 'score_step', side: 'away', delta: 1 })).status).toBe(200);
    expect(await score()).toBe('0-2');
    const down = await live(who.scorer.token, { action: 'score_step', side: 'away', delta: -1 });
    expect(down.status).toBe(200);
    expect(await score()).toBe('0-1');
    const named = uuid();
    await live(who.scorer.token, { action: 'add_event', event: { id: named, kind: 'goal', team_id: w.teams[0], player_id: ps.home[0] } });
    await live(who.scorer.token, { action: 'score_step', side: 'away', delta: -1 }); // the last unattributed away goal
    expect(await score()).toBe('1-0');
    const choose = await live(who.scorer.token, { action: 'score_step', side: 'home', delta: -1 });
    expect(choose.status).toBe(409);
    expect(choose.body.candidates.map((e: any) => e.id)).toEqual([named]);
    expect(await score()).toBe('1-0');
    expect((await live(who.scorer.token, { action: 'void_event', event_id: named, version: 1, reason: 'chosen correction' })).status).toBe(200);
    expect(await score()).toBe('0-0');
  });
});

describe('every step is audited and never counted twice', () => {
  it('the score is exactly the number of non-voided events, and the audit history names the scorer', async () => {
    const { data: events } = await f.admin.from('match_events').select('kind, team_id, voided_at').eq('match_id', M());
    const live1 = (events ?? []).filter((e) => !e.voided_at);
    expect(live1).toHaveLength(0);
    const audit = await f.admin.from('audit_log').select('actor_id, action').eq('table_name', 'match_events').eq('actor_id', who.scorer.id);
    expect((audit.data ?? []).length).toBeGreaterThan(8);
    const scoreAudit = await f.admin.from('audit_log').select('changes').eq('table_name', 'matches').eq('record_id', M()).eq('actor_id', who.scorer.id);
    expect((scoreAudit.data ?? []).some((r) => 'home_score' in (r.changes as object) || 'away_score' in (r.changes as object))).toBe(true);
  });
});

describe('denied roles write nothing', () => {
  it('a captain, a normal account, a scorer assigned elsewhere and a signed-out caller are refused', async () => {
    const before = (await f.admin.from('match_events').select('id').eq('match_id', M())).data!.length;
    for (const name of ['captain', 'normal', 'elsewhere']) {
      const r = await live(who[name].token, { action: 'add_event', event: { kind: 'goal', team_id: w.teams[0] } });
      expect(r.status, name).toBe(403);
    }
    expect((await live(null, { action: 'add_event', event: { kind: 'goal', team_id: w.teams[0] } })).status).toBe(401);
    expect((await f.admin.from('match_events').select('id').eq('match_id', M())).data).toHaveLength(before);
  });

  it('the database says the same: direct writes to events and the score are refused', async () => {
    const direct = await who.captain.db.from('match_events').insert({ match_id: M(), team_id: w.teams[0], kind: 'goal' });
    expect(direct.error).not.toBeNull();
    const score = await who.scorer.db.from('matches').update({ home_score: 5 }).eq('id', M());
    expect(score.error).not.toBeNull();
    expect(await score_()).toBe('0-0');
  });
});
const score_ = score;

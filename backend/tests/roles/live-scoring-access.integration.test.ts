// Group: auth-roles. The live scoring route accepts a dictator and a scorer assigned to the match or its season; it
// refuses a captain, a normal account, an unassigned or expired scorer, and an assignment without the scorer grant.
// The handler runs for real against the local stack with each account's token, as the dashboard sends it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { account, cleanup, startFixture, world } from './fixture';


const f = startFixture();
let w: Awaited<ReturnType<typeof world>>;
const who: Record<string, Awaited<ReturnType<typeof account>>> = {};
const tag = `rl${Date.now().toString(36)}`;

async function score(token: string | null, matchId: string) {
  const { POST } = await import('../../app/api/admin/matches/live/route');
  const res = await POST(new Request('http://localhost/api/admin/matches/live', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ match_id: matchId, action: 'update_time', minute: '12' }),
  }));
  return res.status;
}

beforeAll(async () => {
  Object.assign(process.env, { SUPABASE_URL: f.keys.url, SUPABASE_PUBLISHABLE_KEY: f.keys.publishable, SUPABASE_SECRET_KEY: f.keys.secret });
  w = await world(f, tag);
  who.dictator = await account(f, 'dictator', ['dictator']);
  who.matchScorer = await account(f, 'match-scorer', ['scorer']);
  who.seasonScorer = await account(f, 'season-scorer', ['scorer']);
  who.expired = await account(f, 'expired', ['scorer']);
  who.noGrant = await account(f, 'no-grant');
  who.captain = await account(f, 'captain', ['captain']);
  who.normal = await account(f, 'normal');
  const rows = [
    { user_id: who.matchScorer.id, match_id: w.matches[0] },
    { user_id: who.seasonScorer.id, season_id: w.seasons.cur },
    { user_id: who.expired.id, match_id: w.matches[0], expires_at: new Date(Date.now() - 3600_000).toISOString() },
    { user_id: who.noGrant.id, match_id: w.matches[0] }, // an assignment without the scorer grant gives nothing
  ];
  const r = await f.admin.from('scorer_assignments').insert(rows);
  if (r.error) throw r.error;
  await f.admin.from('captain_assignments').insert({ team_entry_id: w.entries.cur[0], user_id: who.captain.id });
}, 120000);

afterAll(async () => cleanup(f), 60000);

describe('live scoring access', () => {
  it('accepts a dictator on any match', async () => {
    expect(await score(who.dictator.token, w.matches[1])).toBe(200);
  });

  it('accepts a scorer on the assigned match, and refuses them on another', async () => {
    expect(await score(who.matchScorer.token, w.matches[0])).toBe(200);
    expect(await score(who.matchScorer.token, w.matches[1])).toBe(403);
  });

  it('accepts a season scorer on every match of the season', async () => {
    expect(await score(who.seasonScorer.token, w.matches[0])).toBe(200);
    expect(await score(who.seasonScorer.token, w.matches[1])).toBe(200);
  });

  it('refuses an expired scorer assignment, an assignment without the grant, a captain and a normal account', async () => {
    for (const name of ['expired', 'noGrant', 'captain', 'normal']) expect(await score(who[name].token, w.matches[0]), name).toBe(403);
  });

  it('refuses a caller who is not signed in', async () => {
    expect(await score(null, w.matches[0])).toBe(401);
  });

  it('writes nothing for a refused caller: the database says the same as the route', async () => {
    const before = (await f.admin.from('matches').select('minute').eq('id', w.matches[1]).single()).data;
    const direct = await who.captain.db.from('matches').update({ minute: '99' }).eq('id', w.matches[1]).select('id');
    expect(direct.data ?? []).toHaveLength(0);
    expect((await f.admin.from('matches').select('minute').eq('id', w.matches[1]).single()).data).toEqual(before);
  });

  it('lists matches for scoring: a dictator sees them all, a scorer only those assigned', async () => {
    const { GET } = await import('../../app/api/admin/matches/route');
    const list = async (token: string) => {
      const res = await GET(new Request(`http://localhost/api/admin/matches?division=${tag}`, { headers: { Authorization: `Bearer ${token}` } }));
      return ((await res.json()).data as { id: string }[]).map((m) => m.id).sort();
    };
    expect(await list(who.dictator.token)).toEqual([...w.matches].sort());
    expect(await list(who.matchScorer.token)).toEqual([w.matches[0]]);
    expect(await list(who.normal.token)).toEqual([]);
  });
});

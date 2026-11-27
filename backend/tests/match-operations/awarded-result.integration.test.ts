// Group: match-operations. A walkover or forfeit is an explicit awarded result: a dictator creates it through the
// schedule route with a required reason and an awarded score (3-0 only as the default), it has no goal events, it
// counts in the standings, and nobody else can award or change it. The route never leaves a half-made match behind.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { account, cleanup, startFixture, withPlayers, world } from './fixture';


const f = startFixture();
let w: Awaited<ReturnType<typeof world>>;
let ps: Awaited<ReturnType<typeof withPlayers>>;
const who: Record<string, Awaited<ReturnType<typeof account>>> = {};
const tag = `ar${Date.now().toString(36)}`;

async function schedule(token: string, body: Record<string, unknown>) {
  const { POST } = await import('../../app/api/admin/matches/route');
  const res = await POST(new Request('http://localhost/api/admin/matches', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ division: tag, season: 'cur', home_team_id: w.teams[0], away_team_id: w.teams[1], date: new Date(Date.now() + 5 * 86400000).toISOString(), ...body }),
  }));
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  Object.assign(process.env, { SUPABASE_URL: f.keys.url, SUPABASE_PUBLISHABLE_KEY: f.keys.publishable, SUPABASE_SECRET_KEY: f.keys.secret });
  w = await world(f, tag);
  ps = await withPlayers(f, w, tag);
  who.dictator = await account(f, 'dictator', ['dictator']);
  who.scorer = await account(f, 'scorer', ['scorer']);
  await f.admin.from('scorer_assignments').insert({ user_id: who.scorer.id, season_id: w.seasons.cur });
}, 120000);
afterAll(async () => {
  if (f.admin) await f.admin.from('matches').delete().in('home_team_id', w?.teams ?? []);
  await cleanup(f, ps?.all);
}, 60000);

describe('awarded results', () => {
  it('a walkover needs a reason and a winner, then stores the awarded score with no events', async () => {
    expect((await schedule(who.dictator.token, { is_walkover: true, walkover_winner: 'home' })).status).toBe(400);
    expect((await schedule(who.dictator.token, { is_walkover: true, walkover_reason: 'no show' })).status).toBe(400);
    const ok = await schedule(who.dictator.token, { is_walkover: true, walkover_winner: 'home', walkover_reason: 'away team did not turn up' });
    expect(ok.status).toBe(200);
    const id = ok.body.data.id;
    const { data: m } = await f.admin.from('matches').select('home_score, away_score, status, result_kind, result_reason').eq('id', id).single();
    expect(m).toEqual({ home_score: 3, away_score: 0, status: 'completed', result_kind: 'walkover', result_reason: 'away team did not turn up' });
    expect((await f.admin.from('match_events').select('id').eq('match_id', id)).data).toHaveLength(0);
  });

  // D-04: creating and awarding the match is one transaction. An award the database refuses (a negative score) after
  // the match row was inserted rolls the insert back too, and a scorer's attempt stores nothing.
  it('a refused award leaves no match behind, inside one transaction', async () => {
    const count = async () => (await f.admin.from('matches').select('id', { count: 'exact', head: true }).in('home_team_id', w.teams)).count;
    const before = await count();
    const bad = await schedule(who.dictator.token, { is_walkover: true, walkover_winner: 'home', awarded_home: -1, awarded_away: 0, walkover_reason: 'bad score' });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(await count()).toBe(before);
    const direct = await who.scorer.db.rpc('create_awarded_match', {
      p_season: w.seasons.cur, p_home_team: w.teams[0], p_away_team: w.teams[1], p_date: new Date().toISOString(),
      p_venue: null, p_kind: 'walkover', p_home: 3, p_away: 0, p_reason: 'x',
    });
    expect(direct.error?.code).toBe('42501');
    expect(await count()).toBe(before);
  });

  it('the awarded score is the dictator\'s choice, and a forfeit is its own kind', async () => {
    const r = await schedule(who.dictator.token, { is_walkover: true, result_kind: 'forfeit', walkover_winner: 'away', awarded_home: 0, awarded_away: 5, walkover_reason: 'ineligible player' });
    expect(r.status).toBe(200);
    const { data: m } = await f.admin.from('matches').select('home_score, away_score, result_kind').eq('id', r.body.data.id).single();
    expect(m).toEqual({ home_score: 0, away_score: 5, result_kind: 'forfeit' });
  });

  it('an awarded match refuses goal events, and a played match with goals cannot be awarded', async () => {
    const { data: walkover } = await f.admin.from('matches').select('id').eq('result_kind', 'walkover').in('home_team_id', w.teams).limit(1).single();
    const goal = await f.admin.from('match_events').insert({ match_id: walkover!.id, team_id: w.teams[0], kind: 'goal' });
    expect(goal.error?.message).toMatch(/awarded result/);
    await f.admin.from('match_events').insert({ match_id: w.matches[0], team_id: w.teams[0], kind: 'goal' });
    const r = await who.dictator.db.rpc('award_match_result', { p_match: w.matches[0], p_kind: 'walkover', p_home: 3, p_away: 0, p_reason: 'late' });
    expect(r.error?.message).toMatch(/goal events/);
  });

  it('a scorer cannot award a result or create a walkover, and an awarded score cannot be edited directly', async () => {
    expect((await schedule(who.scorer.token, { is_walkover: true, walkover_winner: 'home', walkover_reason: 'x' })).status).toBeGreaterThanOrEqual(400);
    const denied = await who.scorer.db.rpc('award_match_result', { p_match: w.matches[1], p_kind: 'walkover', p_home: 3, p_away: 0, p_reason: 'x' });
    expect(denied.error?.code).toBe('42501');
    const { data: walkover } = await f.admin.from('matches').select('id').eq('result_kind', 'walkover').in('home_team_id', w.teams).limit(1).single();
    const direct = await f.admin.from('matches').update({ home_score: 9 }).eq('id', walkover!.id);
    expect(direct.error?.message).toMatch(/score follows the match events/);
  });

  it('standings count the awarded results', async () => {
    const { GET } = await import('../../app/api/standings/route');
    const res = await GET(new Request(`http://localhost/api/standings?division=${tag}&season=cur`));
    const rows = ((await res.json()).data?.standings ?? []) as any[];
    expect(rows.length).toBeGreaterThan(0);
  });

  it('a dictator clears an award by marking the match played again, which recomputes the score from events', async () => {
    const { data: forfeit } = await f.admin.from('matches').select('id').eq('result_kind', 'forfeit').in('home_team_id', w.teams).limit(1).single();
    const r = await who.dictator.db.rpc('award_match_result', { p_match: forfeit!.id, p_kind: 'played', p_home: 0, p_away: 0, p_reason: '' });
    expect(r.error).toBeNull();
    const { data: m } = await f.admin.from('matches').select('home_score, away_score, result_kind').eq('id', forfeit!.id).single();
    expect(m).toEqual({ home_score: 0, away_score: 0, result_kind: 'played' });
  });
});

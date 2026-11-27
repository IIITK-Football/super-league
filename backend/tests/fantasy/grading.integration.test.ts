// Group: fantasy. Grading reads match events: scoreline from the cached score, player points from attributed goals and
// their assisters. Grading twice gives the same points; a correction after grading flags "needs regrade" and regrading
// gives the corrected points; only a dictator grades or regrades; the history breakdown explains the same points.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { account, cleanup, startFixture, withPlayers, world } from '../match-operations/fixture';


const f = startFixture();
let w: Awaited<ReturnType<typeof world>>;
let ps: Awaited<ReturnType<typeof withPlayers>>;
const who: Record<string, Awaited<ReturnType<typeof account>>> = {};
const tag = `gr${Date.now().toString(36)}`;
const M = () => w.matches[0];
let goalId = '';

async function post(path: string, token: string | null, body: unknown) {
  const { POST } = await import(`../../app/api/${path}/route`);
  const res = await POST(new Request(`http://localhost/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}
async function get(path: string, token: string, query: string) {
  const { GET } = await import(`../../app/api/${path}/route`);
  const res = await GET(new Request(`http://localhost/api/${path}?${query}`, { headers: { Authorization: `Bearer ${token}` } }));
  return { status: res.status, body: await res.json() };
}
const prediction = async () => (await f.admin.from('predictions').select('points_awarded, status, graded_events_version').eq('match_id', M()).eq('user_id', who.fan.id).single()).data!;
const version = async () => (await f.admin.from('matches').select('events_version').eq('id', M()).single()).data!.events_version;

beforeAll(async () => {
  Object.assign(process.env, { SUPABASE_URL: f.keys.url, SUPABASE_PUBLISHABLE_KEY: f.keys.publishable, SUPABASE_SECRET_KEY: f.keys.secret });
  w = await world(f, tag);
  ps = await withPlayers(f, w, tag);
  who.dictator = await account(f, 'dictator', ['dictator']);
  who.fan = await account(f, 'fan');
  // 1-0 to the home side: the goal's scorer is not known yet. The fan predicted 1-0 with home[0] scoring and home[1] assisting.
  const { data, error } = await f.admin.from('match_events').insert({ match_id: M(), team_id: w.teams[0], kind: 'goal', minute: 20 }).select('id').single();
  if (error) throw error;
  goalId = data!.id;
  await f.admin.from('matches').update({ status: 'completed' }).eq('id', M());
  const p = await f.admin.from('predictions').insert({ user_id: who.fan.id, match_id: M(), predicted_home_score: 1, predicted_away_score: 0, predicted_scorers: [ps.home[0]], predicted_assists: [ps.home[1]] });
  if (p.error) throw p.error;
}, 120000);
afterAll(async () => cleanup(f, ps?.all), 60000);

describe('grading from events', () => {
  it('only a dictator grades or regrades', async () => {
    expect((await post('admin/predictions/grade', who.fan.token, { match_id: M() })).status).toBe(403);
    expect((await post('admin/predictions/grade', null, { match_id: M() })).status).toBe(401);
    expect((await post('admin/predictions/regrade-all', who.fan.token, {})).status).toBe(403);
    expect((await prediction()).status).not.toBe('graded');
  });

  it('an unattributed goal earns the scoreline points only', async () => {
    const r = await post('admin/predictions/grade', who.dictator.token, { match_id: M() });
    expect(r.status).toBe(200);
    expect(await prediction()).toMatchObject({ points_awarded: 300, status: 'graded', graded_events_version: await version() });
  });

  it('grading again gives the same points', async () => {
    await post('admin/predictions/grade', who.dictator.token, { match_id: M() });
    // regrade-all is not called here: it regrades every graded prediction in the shared database, seed rows included.
    expect((await prediction()).points_awarded).toBe(300);
  });

  it('a correction after grading flags needs regrade; regrading gives the corrected points', async () => {
    const before = await get('admin/matches', who.dictator.token, `division=${tag}&season=cur`);
    expect(before.body.data.find((m: any) => m.id === M()).needs_regrade).toBe(false);
    const fixed = await f.admin.from('match_events').update({ player_id: ps.home[0], assist_player_id: ps.home[1] }).eq('id', goalId);
    expect(fixed.error).toBeNull();
    const flagged = await get('admin/matches', who.dictator.token, `division=${tag}&season=cur`);
    expect(flagged.body.data.find((m: any) => m.id === M()).needs_regrade).toBe(true);
    expect((await prediction()).points_awarded).toBe(300); // nothing regrades silently
    expect((await post('admin/predictions/grade', who.dictator.token, { match_id: M() })).status).toBe(200);
    expect(await prediction()).toMatchObject({ points_awarded: 300 + 100 + 50, graded_events_version: await version() });
    const after = await get('admin/matches', who.dictator.token, `division=${tag}&season=cur`);
    expect(after.body.data.find((m: any) => m.id === M()).needs_regrade).toBe(false);
  });

  it('the history breakdown explains the same points from the events', async () => {
    const r = await get('predictions/history', who.fan.token, `division=${tag}&season=cur`);
    expect(r.status).toBe(200);
    const row = r.body.data.find((p: any) => p.match_id === M());
    const total = row.breakdown.reduce((n: number, b: { points: number }) => n + b.points, 0);
    expect(total).toBe(450);
  });

  it('refuses to grade a match that is not completed', async () => {
    const r = await post('admin/predictions/grade', who.dictator.token, { match_id: w.matches[1] });
    expect(r.status).toBe(400);
  });
});

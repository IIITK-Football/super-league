// Group: match-operations. Everything derived from events follows the documented rules on a canonical fixture: the cached
// score (goals plus the other side's own goals), the standings through the real route, and the season statistics lines
// (goals, assists, own goals, cards). Changing an attribution moves a goal between players' lines; unattributed goals
// count toward the score and toward no line.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { account, cleanup, startFixture, withPlayers, world } from './fixture';

const f = startFixture();
let w: Awaited<ReturnType<typeof world>>;
let ps: Awaited<ReturnType<typeof withPlayers>>;
const tag = `dr${Date.now().toString(36)}`;
const M = () => w.matches[0];
const line = async (player: string) => (await f.admin.from('season_player_stats').select('goals, assists, own_goals, yellow_cards, red_cards').eq('season_id', w.seasons.cur).eq('player_id', player).maybeSingle()).data;
const ids: Record<string, string> = {};

beforeAll(async () => {
  Object.assign(process.env, { SUPABASE_URL: f.keys.url, SUPABASE_PUBLISHABLE_KEY: f.keys.publishable, SUPABASE_SECRET_KEY: f.keys.secret });
  w = await world(f, tag);
  ps = await withPlayers(f, w, tag);
  await account(f, 'unused'); // keeps the fixture's cleanup covering accounts created here
  const rows = [
    { key: 'g1', team_id: w.teams[0], kind: 'goal', player_id: ps.home[0], assist_player_id: ps.home[1], minute: 10 },
    { key: 'g2', team_id: w.teams[0], kind: 'goal', player_id: ps.home[0], minute: 30 },
    { key: 'u1', team_id: w.teams[0], kind: 'goal', minute: 50 },
    { key: 'og', team_id: w.teams[1], kind: 'own_goal', player_id: ps.away[0], minute: 60 }, // credits the home side
    { key: 'a1', team_id: w.teams[1], kind: 'goal', player_id: ps.away[1], minute: 70 },
    { key: 'y1', team_id: w.teams[1], kind: 'yellow', player_id: ps.away[1], minute: 71 },
    { key: 'r1', team_id: w.teams[0], kind: 'red', player_id: ps.home[1], minute: 80 },
  ];
  for (const { key, ...row } of rows) {
    const { data, error } = await f.admin.from('match_events').insert({ match_id: M(), ...row }).select('id').single();
    if (error) throw error;
    ids[key] = data!.id;
  }
  await f.admin.from('matches').update({ status: 'completed' }).eq('id', M());
}, 120000);
afterAll(async () => cleanup(f, ps?.all), 60000);

describe('derived results on the canonical fixture', () => {
  it('the cached score is the non-voided goals plus the other side\'s own goals', async () => {
    const { data } = await f.admin.from('matches').select('home_score, away_score').eq('id', M()).single();
    expect(data).toEqual({ home_score: 4, away_score: 1 });
  });

  it('the standings route reads that result', async () => {
    const { GET } = await import('../../app/api/standings/route');
    const res = await GET(new Request(`http://localhost/api/standings?division=${tag}&season=cur`));
    const body = await res.json();
    const rows = (body.data?.standings ?? body.data) as any[];
    const home = rows.find((t) => t.teamId === w.teams[0]);
    const away = rows.find((t) => t.teamId === w.teams[1]);
    expect(home.stats).toMatchObject({ won: 1, points: 3, goalsFor: 4, goalsAgainst: 1 });
    expect(away.stats).toMatchObject({ lost: 1, points: 0, goalsFor: 1, goalsAgainst: 4 });
  });

  it('season lines count goals, assists, own goals and cards; unattributed goals appear in no line', async () => {
    expect(await line(ps.home[0])).toMatchObject({ goals: 2, assists: 0 });
    expect(await line(ps.home[1])).toMatchObject({ goals: 0, assists: 1, red_cards: 1 });
    expect(await line(ps.away[0])).toMatchObject({ goals: 0, own_goals: 1 });
    expect(await line(ps.away[1])).toMatchObject({ goals: 1, yellow_cards: 1 });
    const { data } = await f.admin.from('season_player_stats').select('goals').eq('season_id', w.seasons.cur);
    expect((data ?? []).reduce((n, r) => n + r.goals, 0)).toBe(3); // 5 goal-or-own-goal scorers' events minus unattributed and own goal
  });

  it('changing an attribution moves the goal between lines and leaves the score alone', async () => {
    const { error } = await f.admin.from('match_events').update({ player_id: ps.home[1], assist_player_id: null }).eq('id', ids.g2);
    expect(error).toBeNull();
    expect(await line(ps.home[0])).toMatchObject({ goals: 1 });
    expect(await line(ps.home[1])).toMatchObject({ goals: 1, assists: 1 });
    const { data } = await f.admin.from('matches').select('home_score, away_score').eq('id', M()).single();
    expect(data).toEqual({ home_score: 4, away_score: 1 });
  });

  it('attributing an unattributed goal adds a line entry without moving the score', async () => {
    expect(await line(ps.home[0])).toMatchObject({ goals: 1 });
    await f.admin.from('match_events').update({ player_id: ps.home[0] }).eq('id', ids.u1);
    expect(await line(ps.home[0])).toMatchObject({ goals: 2 });
    const { data } = await f.admin.from('matches').select('home_score').eq('id', M()).single();
    expect(data!.home_score).toBe(4);
  });

  it('a voided goal leaves the score and the line', async () => {
    await f.admin.from('match_events').update({ voided_at: new Date().toISOString(), void_reason: 'offside' }).eq('id', ids.a1);
    expect(await line(ps.away[1])).toMatchObject({ goals: 0 });
    const { data } = await f.admin.from('matches').select('home_score, away_score').eq('id', M()).single();
    expect(data).toEqual({ home_score: 4, away_score: 0 });
  });
});

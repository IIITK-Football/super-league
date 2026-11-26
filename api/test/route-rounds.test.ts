// Group: api-services. D-04: at most three sequential Data API rounds per route. Every GET the Worker serves for the
// active product is called against THIS repository's local Supabase stack and seed, as a visitor and, for the
// dictator's list, as a dictator; the count comes from the Worker's own Server-Timing accounting. The World Cup
// archive (D-02) is outside the parity gate and not counted here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { clients, localKeys, uniqueEmail } from '../../backend/tests/auth/local-supabase';

const keys = localKeys();
const admin = clients(keys).admin;
let app: ReturnType<typeof createApp>;
let dictator = { id: '', token: '' };
const ids = { team: '', player: '', match: '' };

beforeAll(async () => {
  Object.assign(process.env, { SUPABASE_URL: keys.url, SUPABASE_PUBLISHABLE_KEY: keys.publishable, SUPABASE_SECRET_KEY: keys.secret, SL_ENVIRONMENT: 'local' });
  app = createApp();
  const { data: season } = await admin.from('seasons').select('id, division:divisions!inner(slug)').eq('division.slug', 'super-league').eq('is_current', true).single();
  ids.team = (await admin.from('team_entries').select('team_id').eq('season_id', season!.id).limit(1).single()).data!.team_id;
  ids.player = (await admin.from('roster_memberships').select('player_id').eq('season_id', season!.id).limit(1).single()).data!.player_id;
  ids.match = (await admin.from('matches').select('id').eq('season_id', season!.id).limit(1).single()).data!.id;

  const email = uniqueEmail('rounds-dictator');
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  await admin.from('user_roles').insert({ user_id: data.user.id, role: 'dictator' });
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const v = await clients(keys).anon().auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'magiclink' });
  if (v.error) throw v.error;
  dictator = { id: data.user.id, token: v.data.session!.access_token };
}, 60000);

afterAll(async () => {
  if (dictator.id) await admin.auth.admin.deleteUser(dictator.id);
}, 30000);

const rounds = (header: string | null) => Number(/rounds=(\d+)/.exec(header ?? '')?.[1] ?? NaN);

describe('sequential Data API rounds per route (local, real data)', () => {
  const visitorRoutes = () => [
    '/home/dashboard?division=super-league',
    '/schedule?division=super-league',
    '/standings?division=super-league',
    '/teams?division=super-league',
    `/teams/${ids.team}/matches`,
    '/players?division=super-league',
    `/players/${ids.player}`,
    '/news?limit=5',
    '/leaderboard?division=super-league',
    '/predictions/leaderboard?division=super-league',
    `/predictions/${ids.match}`,
  ];

  it('every visitor read answers in at most three rounds', async () => {
    const over: string[] = [];
    for (const path of visitorRoutes()) {
      const res = await app.request(`http://localhost/api${path}`);
      const n = rounds(res.headers.get('Server-Timing'));
      expect(res.status, path).toBeLessThan(500);
      if (!(n <= 3)) over.push(`${path}: ${n}`);
    }
    expect(over).toEqual([]);
  });

  it("the dictator's match list and a signed-in history answer in at most three rounds", async () => {
    const over: string[] = [];
    for (const path of ['/admin/matches?division=super-league', '/predictions/history?division=super-league']) {
      const res = await app.request(`http://localhost/api${path}`, { headers: { Authorization: `Bearer ${dictator.token}` } });
      const n = rounds(res.headers.get('Server-Timing'));
      expect(res.status, path).toBeLessThan(500);
      if (!(n <= 3)) over.push(`${path}: ${n}`);
    }
    expect(over).toEqual([]);
  });
});

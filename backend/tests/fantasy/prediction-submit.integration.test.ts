// Group: fantasy. Submitting a prediction through the API route runs as the signed-in fan (D-04): the route forwards
// their token, so row level security stores the prediction under their own id. Before 2026-11-26 the route built its
// client without the token and refused every fan with 401. A visitor is still refused and nothing is stored.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clients, localKeys, uniqueEmail } from '../auth/local-supabase';

let admin: SupabaseClient;
let fan = { id: '', token: '' };
let matchId = '';

const submit = async (token: string | null, body: Record<string, unknown>) => {
  const { POST } = await import('../../app/api/predictions/route');
  const res = await POST(new Request('http://localhost/api/predictions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  const keys = localKeys();
  Object.assign(process.env, { SUPABASE_URL: keys.url, SUPABASE_PUBLISHABLE_KEY: keys.publishable, SUPABASE_SECRET_KEY: keys.secret });
  admin = clients(keys).admin;
  const { data: season } = await admin.from('seasons').select('id, division:divisions!inner(slug)').eq('division.slug', 'super-league').eq('is_current', true).single();
  const teams = ((await admin.from('team_entries').select('team_id').eq('season_id', season!.id).limit(2)).data ?? []).map((e) => e.team_id);
  const { data: match, error } = await admin.from('matches').insert({
    home_team_id: teams[0], away_team_id: teams[1], season_id: season!.id, status: 'scheduled', date: '2031-03-01T10:00:00Z',
  }).select('id').single();
  if (error) throw error;
  matchId = match!.id;

  const email = uniqueEmail('predict');
  const { data, error: userError } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (userError) throw userError;
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const v = await clients(keys).anon().auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'magiclink' });
  if (v.error) throw v.error;
  fan = { id: data.user.id, token: v.data.session!.access_token };
}, 60000);

afterAll(async () => {
  if (!admin) return;
  if (matchId) {
    await admin.from('predictions').delete().eq('match_id', matchId);
    await admin.from('matches').delete().eq('id', matchId);
  }
  if (fan.id) await admin.auth.admin.deleteUser(fan.id);
}, 30000);

describe('prediction submission', () => {
  const prediction = () => ({ match_id: matchId, predicted_home_score: 1, predicted_away_score: 0, predicted_scorers: ['someone'], predicted_assists: [] });

  it('stores a signed-in fan\'s prediction under their own id', async () => {
    const r = await submit(fan.token, prediction());
    expect(r.status).toBe(200);
    const { data } = await admin.from('predictions').select('user_id, predicted_home_score, predicted_away_score').eq('match_id', matchId);
    expect(data).toEqual([{ user_id: fan.id, predicted_home_score: 1, predicted_away_score: 0 }]);
  });

  it('refuses a visitor and stores nothing for them', async () => {
    const before = (await admin.from('predictions').select('id', { count: 'exact', head: true }).eq('match_id', matchId)).count;
    expect((await submit(null, prediction())).status).toBe(401);
    expect((await admin.from('predictions').select('id', { count: 'exact', head: true }).eq('match_id', matchId)).count).toBe(before);
  });

  it('refuses match prediction reads and writes when its season has disabled fantasy', async () => {
    const { data: existing } = await admin.from('matches').select('home_team_id, away_team_id, season:seasons(division_id)')
      .eq('id', matchId).single();
    const scope = existing!.season as unknown as { division_id: string };
    const { data: season, error: seasonError } = await admin.from('seasons').insert({
      division_id: scope.division_id, name: 'Disabled fantasy', slug: `fantasy-off-${Date.now()}`, visibility: 'public',
    }).select('id').single();
    if (seasonError) throw seasonError;
    let disabledMatch: string | undefined;
    try {
      const settings = await admin.from('season_sections').insert({ season_id: season!.id, section_key: 'fantasy', enabled: false });
      if (settings.error) throw settings.error;
      const { data, error } = await admin.from('matches').insert({
        home_team_id: existing!.home_team_id, away_team_id: existing!.away_team_id,
        season_id: season!.id, status: 'scheduled', date: '2031-03-01T10:00:00Z',
      }).select('id').single();
      if (error) throw error;
      disabledMatch = data!.id;
      const { GET, POST } = await import('../../app/api/predictions/[match_id]/route');
      const params = { params: Promise.resolve({ match_id: disabledMatch! }) };
      const url = `http://localhost/api/predictions/${disabledMatch}`;
      const headers = { Authorization: `Bearer ${fan.token}`, 'Content-Type': 'application/json' };
      expect((await GET(new Request(url, { headers }), params)).status).toBe(404);
      expect((await POST(new Request(url, { method: 'POST', headers, body: JSON.stringify(prediction()) }), params)).status).toBe(404);
      const { count } = await admin.from('predictions').select('id', { count: 'exact', head: true }).eq('match_id', disabledMatch);
      expect(count).toBe(0);
    } finally {
      if (disabledMatch) await admin.from('matches').delete().eq('id', disabledMatch);
      await admin.from('seasons').delete().eq('id', season!.id);
    }
  });

});

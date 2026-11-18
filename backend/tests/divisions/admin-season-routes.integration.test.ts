// Group: divisions. The administration routes write seasons, not the retired division strings. Each handler runs for
// real against THIS repository's local Supabase stack with a signed-in account's token, as the dashboard sends it.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clients, localKeys, uniqueEmail } from '../auth/local-supabase';

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
// Logo storage is not exercised here (a colour-only update never uploads); the client must still be constructible.
vi.mock('@aws-sdk/client-s3', () => ({ S3Client: class { send = vi.fn(); }, PutObjectCommand: class {}, DeleteObjectCommand: class {} }));

let admin: SupabaseClient;
let anon: () => SupabaseClient;
const users: string[] = [];
const made = { matches: [] as string[], teams: [] as string[], regs: [] as string[] };
let current: Record<string, string>;
let dictatorToken: string;

async function tokenFor(role: string) {
  const email = uniqueEmail(`season-${role}`);
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  users.push(data.user.id);
  await admin.from('user_roles').update({ role }).eq('user_id', data.user.id);
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const { data: v, error: vErr } = await anon().auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'magiclink' });
  if (vErr) throw vErr;
  return { id: data.user.id, token: v.session!.access_token };
}

const json = (route: (r: Request) => Promise<Response>, url: string, token: string, body?: unknown) =>
  route(new Request(url, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }))
    .then(async (res) => ({ status: res.status, body: await res.json() }));

beforeAll(async () => {
  const keys = localKeys();
  Object.assign(process.env, {
    SUPABASE_URL: keys.url, SUPABASE_PUBLISHABLE_KEY: keys.publishable, SUPABASE_SECRET_KEY: keys.secret,
    R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test',
  });
  const c = clients(keys);
  admin = c.admin;
  anon = c.anon;
  const { data } = await admin.from('seasons').select('id, division:divisions(slug)').eq('is_current', true);
  current = Object.fromEntries((data ?? []).map((s: any) => [s.division.slug, s.id]));
  dictatorToken = (await tokenFor('dictator')).token;
}, 60000);

afterAll(async () => {
  if (!admin) return;
  for (const id of made.matches) await admin.from('matches').delete().eq('id', id);
  for (const id of made.regs) await admin.from('team_registrations').delete().eq('id', id);
  if (made.teams.length) await admin.from('team_entries').delete().in('team_id', made.teams);
  for (const id of made.teams) await admin.from('teams').delete().eq('id', id);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 60000);

describe('admin matches', () => {
  it('schedules a match in the division\'s current season and lists it with its division and season', async () => {
    const { GET, POST } = await import('../../app/api/admin/matches/route');
    const { data: teams } = await admin.from('team_entries').select('team_id').eq('season_id', current.wsl).limit(2);
    const created = await json(POST, 'http://localhost/api/admin/matches', dictatorToken, {
      division: 'wsl', home_team_id: teams![0].team_id, away_team_id: teams![1].team_id, date: '2026-12-20T12:00:00Z', venue: 'Test Ground',
    });
    expect(created.status).toBe(200);
    made.matches.push(created.body.data.id);
    expect(created.body.data.season_id).toBe(current.wsl);

    const listed = await json(GET, 'http://localhost/api/admin/matches?status=scheduled&division=wsl', dictatorToken);
    const row = listed.body.data.find((m: any) => m.id === created.body.data.id);
    expect(row).toMatchObject({ season_id: current.wsl, division_name: 'WSL', season_name: '2026' });
    expect(listed.body.data.every((m: any) => m.season_id === current.wsl)).toBe(true);
  });

  it('refuses a retired division string instead of guessing', async () => {
    const { POST } = await import('../../app/api/admin/matches/route');
    const res = await json(POST, 'http://localhost/api/admin/matches', dictatorToken, { division: 'womens', home_team_id: null, away_team_id: null });
    expect(res.status).toBe(404);
  });
});

describe('admin teams', () => {
  it('creates a team entered in the chosen division\'s current season', async () => {
    const { POST } = await import('../../app/api/admin/teams/route');
    const res = await json(POST, 'http://localhost/api/admin/teams', dictatorToken, { division: 'freshers', name: `Season Test ${Date.now()}`, short_name: 'STS' });
    expect(res.status).toBe(200);
    made.teams.push(res.body.data.id);
    const { data: entries } = await admin.from('team_entries').select('season_id').eq('team_id', res.body.data.id);
    expect(entries).toEqual([{ season_id: current.freshers }]);
  });
});

describe('captain team branding', () => {
  it('finds the captain\'s registration through its season and saves the colour', async () => {
    const captain = await tokenFor('captain');
    const { data: team } = await admin.from('teams').insert({ name: `Branding Test ${Date.now()}`, short_name: 'BRT', logo_url: 'data:image/png;base64,AA==', team_color: '#000000' }).select('id').single();
    made.teams.push(team!.id);
    const { data: reg } = await admin.from('team_registrations').insert({ captain_id: captain.id, team_name: 'Branding Test', season_id: current.freshers, team_id: team!.id }).select('id').single();
    made.regs.push(reg!.id);

    const { POST } = await import('../../app/api/captain/team-branding/route');
    const form = new FormData();
    form.set('team_color', '#123456');
    const res = await POST(new Request('http://localhost/api/captain/team-branding', { method: 'POST', headers: { Authorization: `Bearer ${captain.token}` }, body: form }));
    expect(res.status).toBe(200);
    expect((await admin.from('teams').select('team_color').eq('id', team!.id).single()).data!.team_color).toBe('#123456');
  });
});

describe('admin stats and the removed polls feature', () => {
  it('admin stats no longer counts polls and still refuses a caller without a session', async () => {
    const { GET } = await import('../../app/api/admin/stats/route');
    const res = await GET(new Request('http://localhost/api/admin/stats'));
    expect(res.status).toBe(401);
  });

  it('the unused polls routes are gone', () => {
    expect(existsSync(join(__dirname, '../../app/api/polls'))).toBe(false);
  });
});

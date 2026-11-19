// @vitest-environment jsdom
// Group: rosters. The real captain flow: the TeamBuilder page talks to a REAL Supabase Data API through a real
// supabase-js client signed in as a captain who holds a team's registration for a season. The captain changes a
// player's jersey number and rating; the database shows the change on the roster place and the player's card, and
// another team's player is untouched. A user assigned to a team without the captain role is refused and nothing is
// written.
//
// Targets (skipped unless one is chosen):
//   SL_LOCAL_SUPABASE=1     this repository's local stack only (127.0.0.1:54321); run by the rosters test group
//   SL_UI_TARGET=staging    the staging project only, with the same guards and synthetic sl-check- records as
//                           scripts/staging-checks.mjs (reads backend/.env.staging.local; refuses any other project)
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// @ts-ignore plain ESM
import { loadEnvText, verifyTarget } from '../../../../scripts/staging-checks.mjs';

const ROOT = resolve(__dirname, '../../../..');
const TARGET = process.env.SL_UI_TARGET === 'staging' ? 'staging' : process.env.SL_LOCAL_SUPABASE === '1' ? 'local' : null;
const DOMAIN = 'iiitkottayam.ac.in';
const tag = `sl-check-${randomBytes(4).toString('hex')}`;

const holder = vi.hoisted(() => ({ client: null, user: null }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...a) => holder.client.from(...a),
    rpc: (...a) => holder.client.rpc(...a),
    auth: { getSession: (...a) => holder.client.auth.getSession(...a) },
  },
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: holder.user, role: holder.user?.role }) }));

import { TeamBuilder } from '../TeamBuilder';

function connection() {
  if (TARGET === 'local') {
    const r = spawnSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], { encoding: 'utf8', cwd: join(ROOT, 'backend') });
    if (r.status !== 0) throw new Error('Local Supabase is not running. Start it with: pnpm db:start');
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    if (out.API_URL !== 'http://127.0.0.1:54321') throw new Error('Refusing to run: the API is not the local stack on 127.0.0.1:54321');
    return { url: out.API_URL, publishable: out.PUBLISHABLE_KEY, secret: out.SECRET_KEY };
  }
  const file = join(ROOT, 'backend/.env.staging.local');
  if (!existsSync(file)) throw new Error('backend/.env.staging.local is missing (see docs/release.md)');
  const env = loadEnvText(readFileSync(file, 'utf8'));
  const problems = verifyTarget(env);
  if (problems.length) throw new Error(`refusing to run: ${problems.join('; ')}`);
  return { url: env.SUPABASE_URL, publishable: env.SUPABASE_PUBLISHABLE_KEY, secret: env.SUPABASE_SECRET_KEY };
}

const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
let conn;
let admin;
const users = [];
const made = { division: null, season: null, division2: null, season2: null, teams: [], entries: [], players: [], places: [], regs: [] };

const must = (r) => {
  if (r.error) throw new Error(`setup failed: ${JSON.stringify(r.error)}`);
  return r.data;
};

async function signedInAs(role) {
  const email = `${tag}-tb-${role}@${DOMAIN}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: randomBytes(16).toString('hex'), email_confirm: true });
  if (error) throw error;
  users.push(data.user.id);
  must(await admin.from('user_roles').upsert({ user_id: data.user.id, role }, { onConflict: 'user_id' }));
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error) throw link.error;
  const client = createClient(conn.url, conn.publishable, opts);
  const verified = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' });
  if (verified.error) throw verified.error;
  return { id: data.user.id, role, client };
}

describe.skipIf(!TARGET)(`TeamBuilder through the real Data API (${TARGET ?? 'skipped'})`, () => {
  let captain;
  let noRole;

  beforeAll(async () => {
    conn = connection();
    admin = createClient(conn.url, conn.secret, opts);
    made.division = must(await admin.from('divisions').insert({ slug: tag, name: `SL Check ${tag}` }).select('id').single()).id;
    made.season = must(await admin.from('seasons').insert({ division_id: made.division, slug: '2026', name: `${tag} 2026`, is_current: true }).select('id').single()).id; // captains edit current-season rosters only
    // The other team plays the current season of a second division, so one player can be on both rosters (one
    // shared card, one roster place per season).
    made.division2 = must(await admin.from('divisions').insert({ slug: `${tag}-b`, name: `SL Check ${tag} B` }).select('id').single()).id;
    made.season2 = must(await admin.from('seasons').insert({ division_id: made.division2, slug: '2026', name: `${tag} B 2026`, is_current: true }).select('id').single()).id;
    for (const [name, season] of [['Own', made.season], ['Other', made.season2]]) {
      // Branded, so the builder goes straight to the roster.
      const team = must(await admin.from('teams').insert({ name: `${tag} ${name}`, logo_url: 'https://example.invalid/logo.png', team_color: '#112233' }).select('id').single()).id;
      made.teams.push(team);
      made.entries.push(must(await admin.from('team_entries').insert({ team_id: team, season_id: season }).select('id').single()).id);
    }
    for (const [i, name] of ['Ada', 'Zed'].entries()) {
      const player = must(await admin.from('players').insert({ first_name: `${tag}${name}`, last_name: 'Player', overall_rating: 60 }).select('id').single()).id;
      made.players.push(player);
      made.places.push(must(await admin.from('roster_memberships').insert({ player_id: player, team_entry_id: made.entries[i], season_id: i ? made.season2 : made.season, jersey_number: 7, position: 'CM' }).select('id').single()).id);
    }
    // Ada also plays for the other team: places[2].
    made.places.push(must(await admin.from('roster_memberships').insert({ player_id: made.players[0], team_entry_id: made.entries[1], season_id: made.season2, jersey_number: 9, position: 'CM' }).select('id').single()).id);
    captain = await signedInAs('captain');
    noRole = await signedInAs('default');
    made.regs.push(must(await admin.from('team_registrations').insert({ captain_id: captain.id, team_name: `${tag} Own`, season_id: made.season, team_id: made.teams[0] }).select('id').single()).id);
  }, 90000);

  afterEach(cleanup);

  afterAll(async () => {
    if (!admin) return;
    await admin.from('team_registrations').delete().in('id', made.regs);
    await admin.from('roster_memberships').delete().in('season_id', [made.season, made.season2]);
    await admin.from('players').delete().in('id', made.players);
    await admin.from('team_entries').delete().in('season_id', [made.season, made.season2]);
    await admin.from('teams').delete().in('id', made.teams);
    await admin.from('seasons').delete().in('id', [made.season, made.season2]);
    await admin.from('divisions').delete().in('id', [made.division, made.division2]);
    for (const id of users) await admin.auth.admin.deleteUser(id);
  }, 60000);

  it('a captain edits their own roster player; the roster place and card change, another team does not', async () => {
    holder.client = captain.client;
    holder.user = { id: captain.id, role: 'captain' };
    render(<MemoryRouter><TeamBuilder /></MemoryRouter>);
    await screen.findByRole('button', { name: new RegExp(`01 ${tag}Ada`) }, { timeout: 15000 });
    expect(screen.queryByText(new RegExp(`${tag}Zed`))).toBeNull();
    fireEvent.change(screen.getByLabelText(/jersey number/i), { target: { value: '11' } });
    fireEvent.change(screen.getByLabelText(/overall rating/i), { target: { value: '83' } });
    fireEvent.change(screen.getByLabelText(/position/i), { target: { value: 'ST' } });
    fireEvent.click(screen.getByRole('button', { name: /save player profiles/i }));
    await waitFor(() => expect(screen.getByText(/saved successfully/i)).toBeTruthy(), { timeout: 15000 });
    expect(must(await admin.from('roster_memberships').select('jersey_number, position').eq('id', made.places[0]).single())).toEqual({ jersey_number: 11, position: 'ST' });
    expect(must(await admin.from('players').select('overall_rating, first_name').eq('id', made.players[0]).single())).toEqual({ overall_rating: 83, first_name: `${tag}Ada` });
    expect(must(await admin.from('roster_memberships').select('jersey_number').eq('id', made.places[1]).single()).jersey_number).toBe(7);
    // Ada's card is shared: the other team's roster shows the new rating, but its own jersey is untouched.
    const elsewhere = must(await admin.from('roster_memberships').select('jersey_number, player:players(overall_rating)').eq('id', made.places[2]).single());
    expect(elsewhere).toEqual({ jersey_number: 9, player: { overall_rating: 83 } });
  }, 60000);

  it('the captain cannot write through the other team\'s roster place for the same player, and nothing changes', async () => {
    const r = await captain.client.rpc('captain_update_roster_player', {
      p_membership_id: made.places[2], p_position: 'GK', p_jersey_number: 1, p_overall_rating: 10, p_attributes: {}, p_image_url: null,
    });
    expect(r.error?.message).toMatch(/not part of your assigned roster/);
    const after = must(await admin.from('roster_memberships').select('jersey_number, position, player:players(overall_rating)').eq('id', made.places[2]).single());
    expect(after).toEqual({ jersey_number: 9, position: 'CM', player: { overall_rating: 83 } });
  }, 60000);

  it('a dictator who also captains a team keeps dictator access: picks another team and saves', async () => {
    const boss = await signedInAs('dictator');
    made.regs.push(must(await admin.from('team_registrations').insert({ captain_id: boss.id, team_name: `${tag} Other`, season_id: made.season2, team_id: made.teams[1] }).select('id').single()).id);
    holder.client = boss.client;
    holder.user = { id: boss.id, role: 'dictator' };
    render(<MemoryRouter><TeamBuilder /></MemoryRouter>);
    await screen.findByRole('button', { name: new RegExp(`${tag}Zed`) }, { timeout: 15000 }); // starts on the team they captain
    fireEvent.change(screen.getByLabelText('Division'), { target: { value: made.division } });
    await waitFor(() => expect(screen.getByRole('option', { name: `${tag} 2026 (current)` })).toBeTruthy(), { timeout: 15000 });
    fireEvent.change(screen.getByLabelText('Season'), { target: { value: made.season } });
    await waitFor(() => expect(screen.getByRole('option', { name: `${tag} Own` })).toBeTruthy(), { timeout: 15000 });
    fireEvent.change(screen.getByLabelText('Team'), { target: { value: made.teams[0] } });
    await screen.findByRole('button', { name: new RegExp(`01 ${tag}Ada`) }, { timeout: 15000 });
    fireEvent.change(screen.getByLabelText(/jersey number/i), { target: { value: '21' } });
    fireEvent.click(screen.getByRole('button', { name: /save player profiles/i }));
    await waitFor(() => expect(screen.getByText(/saved successfully/i)).toBeTruthy(), { timeout: 15000 });
    expect(must(await admin.from('roster_memberships').select('jersey_number').eq('id', made.places[0]).single()).jersey_number).toBe(21);
    must(await admin.from('roster_memberships').update({ jersey_number: 11 }).eq('id', made.places[0])); // the next case expects 11
  }, 60000);

  it('a user assigned to the team without the captain role is refused and nothing is written', async () => {
    must(await admin.from('team_registrations').update({ captain_id: noRole.id }).eq('id', made.regs[0]));
    holder.client = noRole.client;
    holder.user = { id: noRole.id, role: 'default' };
    render(<MemoryRouter><TeamBuilder /></MemoryRouter>);
    await screen.findByRole('button', { name: new RegExp(`01 ${tag}Ada`) }, { timeout: 15000 });
    fireEvent.change(screen.getByLabelText(/jersey number/i), { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: /save player profiles/i }));
    await waitFor(() => expect(screen.getByText(/captain access is required/i)).toBeTruthy(), { timeout: 15000 });
    expect(must(await admin.from('roster_memberships').select('jersey_number').eq('id', made.places[0]).single()).jersey_number).toBe(11);
  }, 60000);
});

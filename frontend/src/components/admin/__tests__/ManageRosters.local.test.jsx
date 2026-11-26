// @vitest-environment jsdom
// Group: rosters. The real dictator Teams & Rosters flow: the ManageRosters component, driven like a person would,
// talks to a REAL Supabase Data API through a real supabase-js client signed in as a dictator, and every write is
// checked in the database. It chooses division -> season -> team, adds a team to the season, creates a player for a
// chosen verified account (linked in the same step), edits and moves a player, adds a player from another season (one
// identity, two seasons) and removes a roster place. It
// also creates a new team in the season (create_team_in_season: team and season entry together) and deletes a
// player who never played (delete_unplayed_player: player and roster place together). A normal user using the same
// screen finds no account to create a player for, cannot create a team, and nothing is written.
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
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// @ts-ignore plain ESM
import { loadEnvText, verifyTarget } from '../../../../../scripts/staging-checks.mjs';

const ROOT = resolve(__dirname, '../../../../..');
const TARGET = process.env.SL_UI_TARGET === 'staging' ? 'staging' : process.env.SL_LOCAL_SUPABASE === '1' ? 'local' : null;
const DOMAIN = 'iiitkottayam.ac.in';
const tag = `sl-check-${randomBytes(4).toString('hex')}`;

const holder = vi.hoisted(() => ({ client: null }));
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (...a) => holder.client.from(...a),
    rpc: (...a) => holder.client.rpc(...a),
    auth: { getSession: (...a) => holder.client.auth.getSession(...a) },
  },
}));

import ManageRosters from '../ManageRosters';
// Confirmations are answered by globalThis.confirmAnswer (a vi.fn); the dialog itself is covered by the screens that use it.
vi.mock('../../ui', async (importOriginal) => ({ ...(await importOriginal()), useConfirm: () => globalThis.confirmAnswer }));
globalThis.confirmAnswer = vi.fn(async () => true);

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
const made = { division: null, seasons: {}, teams: {}, entries: {}, veteran: null };

async function signedInAs(role) {
  const email = `${tag}-ui-${role}@${DOMAIN}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: randomBytes(16).toString('hex'), email_confirm: true });
  if (error) throw error;
  users.push(data.user.id);
  // A normal user ('default') holds no grant.
  if (role !== 'default') {
    const roleWrite = await admin.from('user_roles').upsert({ user_id: data.user.id, role }, { onConflict: 'user_id,role', ignoreDuplicates: true });
    if (roleWrite.error) throw roleWrite.error;
  }
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error) throw link.error;
  const client = createClient(conn.url, conn.publishable, opts);
  const verified = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' });
  if (verified.error) throw verified.error;
  return { id: data.user.id, client };
}

const must = (r) => {
  if (r.error) throw new Error(`setup failed: ${JSON.stringify(r.error)}`);
  return r.data;
};

// A verified synthetic account for a new player (every player needs one).
async function verifiedAccount(label) {
  const email = `${tag}-ui-${label}@${DOMAIN}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: randomBytes(16).toString('hex'), email_confirm: true });
  if (error) throw error;
  users.push(data.user.id);
  return { id: data.user.id, email };
}

async function fixtures(dictatorClient) {
  made.division = must(await admin.from('divisions').insert({ visibility: 'public', slug: tag, name: `SL Check ${tag}` }).select('id').single()).id;
  for (const [key, slug, current] of [['now', '2026', true], ['old', '2025', false]]) {
    made.seasons[key] = must(await admin.from('seasons').insert({ visibility: 'public', division_id: made.division, slug, name: `${tag} ${slug}`, is_current: current, sort_order: current ? 2 : 1 }).select('id').single()).id;
  }
  for (const name of ['Alpha', 'Beta', 'Gamma']) made.teams[name] = must(await admin.from('teams').insert({ name: `${tag} ${name}` }).select('id').single()).id;
  for (const [team, season] of [['Alpha', 'now'], ['Beta', 'now'], ['Gamma', 'old']]) {
    made.entries[team] = must(await admin.from('team_entries').insert({ team_id: made.teams[team], season_id: made.seasons[season] }).select('id').single()).id;
  }
  // A player (with an account) who played last season for Gamma.
  const vera = await verifiedAccount('vera');
  made.veteran = must(await dictatorClient.rpc('create_player_for_account', {
    p_user: vera.id, p_team_entry_id: made.entries.Gamma, p_first_name: `${tag}Vera`, p_last_name: 'Veteran', p_jersey_number: 4,
  }));
}

async function removeFixtures() {
  if (!made.division) return;
  const seasonIds = Object.values(made.seasons);
  await admin.from('roster_memberships').delete().in('season_id', seasonIds);
  const { data: players } = await admin.from('players').select('id').ilike('first_name', `${tag}%`);
  await admin.from('players').delete().in('id', (players ?? []).map((p) => p.id));
  await admin.from('team_entries').delete().in('season_id', seasonIds);
  const { data: teams } = await admin.from('teams').select('id').like('name', `${tag}%`);
  await admin.from('teams').delete().in('id', (teams ?? []).map((t) => t.id));
  await admin.from('seasons').delete().in('id', seasonIds);
  await admin.from('divisions').delete().eq('id', made.division);
}

const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const statusText = async (re) => waitFor(() => expect(screen.getByRole('status').textContent).toMatch(re), { timeout: 15000 });
const option = (name) => waitFor(() => expect(screen.getByRole('option', { name })).toBeTruthy(), { timeout: 15000 });

// The new player's account comes first: searched by email and chosen in the form.
async function chooseNewAccount(email) {
  type('New player email search', email);
  const list = await screen.findByRole('list', { name: 'New player matches' }, { timeout: 15000 });
  fireEvent.click(within(list).getByRole('button', { name: `Choose ${email}` }));
}

async function openTeam(team) {
  await option(`SL Check ${tag}`);
  type('Division', made.division);
  await option(`${tag} 2026 (current)`);
  type('Season', made.seasons.now);
  await option(`${tag} Alpha`);
  type('Team', made.entries[team]);
}

describe.skipIf(!TARGET)(`ManageRosters through the real Data API (${TARGET ?? 'skipped'})`, () => {
  let dictator;
  let normal;

  beforeAll(async () => {
    conn = connection();
    admin = createClient(conn.url, conn.secret, opts);
    dictator = await signedInAs('dictator');
    normal = await signedInAs('default');
    await fixtures(dictator.client);
  }, 90000);

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (!admin) return;
    await removeFixtures();
    for (const id of users) await admin.auth.admin.deleteUser(id);
    expect((await admin.from('divisions').select('id').eq('slug', tag)).data ?? []).toEqual([]);
  }, 60000);

  it('a dictator manages the season\'s teams and roster, every write persisted', async () => {
    holder.client = dictator.client;
    globalThis.confirmAnswer = vi.fn(async () => true);
    render(<ManageRosters />);
    await openTeam('Alpha');
    await screen.findByText(/no players on this roster yet/i, {}, { timeout: 15000 });

    // Gamma played only last season: add it to this season.
    type('Existing team', made.teams.Gamma);
    fireEvent.click(screen.getByRole('button', { name: /add team/i }));
    await statusText(/Gamma added to/);
    expect(must(await admin.from('team_entries').select('id').eq('team_id', made.teams.Gamma).eq('season_id', made.seasons.now))).toHaveLength(1);

    // Create a player on Alpha's roster for Ada's verified account.
    const adaAccount = await verifiedAccount('ada');
    const form = screen.getByRole('form', { name: 'New player' });
    await chooseNewAccount(adaAccount.email);
    type('New first name', `${tag}Ada`);
    type('New last name', 'Striker');
    type('New jersey', '9');
    type('New position', 'ST');
    type('New rating', '74');
    fireEvent.click(within(form).getByRole('button', { name: /create player/i }));
    await statusText(/Ada Striker added to .*linked to/);
    const ada = must(await admin.from('players').select('id, overall_rating, user_id, roster_memberships(id, team_entry_id, jersey_number, position)').eq('first_name', `${tag}Ada`).single());
    expect(ada.overall_rating).toBe(74);
    expect(ada.user_id).toBe(adaAccount.id);
    expect(ada.roster_memberships).toEqual([expect.objectContaining({ team_entry_id: made.entries.Alpha, jersey_number: 9, position: 'ST' })]);

    // Edit the card and the roster place.
    fireEvent.click(await screen.findByRole('button', { name: /^Edit .*Ada Striker$/ }));
    type('Edit last name', 'Finisher');
    type('Edit jersey', '10');
    fireEvent.click(screen.getByRole('button', { name: /save player/i }));
    await statusText(/Ada saved/);
    expect(must(await admin.from('players').select('last_name').eq('id', ada.id).single()).last_name).toBe('Finisher');
    expect(must(await admin.from('roster_memberships').select('jersey_number').eq('id', ada.roster_memberships[0].id).single()).jersey_number).toBe(10);

    // Add last season's player: the same identity now has a roster place in two seasons.
    fireEvent.click(screen.getByRole('button', { name: 'Add player' }));
    type('Search players', `${tag}Vera`); // searched as you type, through search_players
    const list = await screen.findByRole('list', { name: 'Matching players' }, { timeout: 15000 });
    expect(within(list).getByText(/Latest: .*· #/)).toBeTruthy(); // the earlier season's roster place tells them apart
    fireEvent.click(within(list).getByRole('button', { name: /^add .* to /i }));
    await statusText(/Veteran added to/);
    expect(must(await admin.from('roster_memberships').select('season_id').eq('player_id', made.veteran)).map((r) => r.season_id).sort())
      .toEqual([made.seasons.now, made.seasons.old].sort());
    expect(must(await admin.from('players').select('id').eq('first_name', `${tag}Vera`))).toHaveLength(1);

    // Move Ada to Beta within the season.
    fireEvent.click(await screen.findByRole('button', { name: /^Edit .*Ada Finisher$/ }));
    type('Move to team', made.entries.Beta);
    fireEvent.click(screen.getByRole('button', { name: /^move$/i }));
    await statusText(/Moved to/);
    expect(must(await admin.from('roster_memberships').select('team_entry_id').eq('id', ada.roster_memberships[0].id).single()).team_entry_id).toBe(made.entries.Beta);

    // Remove the veteran from this season's roster: the player and last season's place stay.
    const veteranPlace = must(await admin.from('roster_memberships').select('id').eq('player_id', made.veteran).eq('season_id', made.seasons.now).single()).id;
    fireEvent.click(await screen.findByRole('button', { name: /^Edit .*Vera Veteran$/ }));
    fireEvent.click(screen.getByRole('button', { name: /remove from roster/i }));
    await statusText(/Removed from the roster/);
    expect(must(await admin.from('roster_memberships').select('season_id').eq('player_id', made.veteran))).toEqual([{ season_id: made.seasons.old }]);
  }, 120000);

  it('a dictator creates a team in the season and deletes a player who never played', async () => {
    holder.client = dictator.client;
    const confirm = globalThis.confirmAnswer = vi.fn(async () => true);
    render(<ManageRosters />);
    await openTeam('Alpha');

    // Create a new team: the team and its season entry are written together (create_team_in_season).
    type('New team name', `${tag} Delta`);
    fireEvent.click(screen.getByRole('button', { name: /create team/i }));
    await statusText(new RegExp(`${tag} Delta created and added to ${tag} 2026`));
    const delta = must(await admin.from('teams').select('id, team_entries(id, season_id)').eq('name', `${tag} Delta`).single());
    expect(delta.team_entries).toEqual([expect.objectContaining({ season_id: made.seasons.now })]);
    await waitFor(() => expect(within(screen.getByLabelText('Team')).getByRole('option', { name: `${tag} Delta` })).toBeTruthy(), { timeout: 15000 });

    // Give Delta a player who never plays, then delete them for good (delete_unplayed_player).
    type('Team', delta.team_entries[0].id);
    await screen.findByText(/no players on this roster yet/i, {}, { timeout: 15000 });
    await chooseNewAccount((await verifiedAccount('temp')).email);
    type('New first name', `${tag}Temp`);
    type('New last name', 'Trialist');
    fireEvent.click(within(screen.getByRole('form', { name: 'New player' })).getByRole('button', { name: /create player/i }));
    await statusText(/Temp Trialist added to/);
    const temp = must(await admin.from('players').select('id, roster_memberships(id)').eq('first_name', `${tag}Temp`).single());
    expect(temp.roster_memberships).toHaveLength(1);
    fireEvent.click(await screen.findByRole('button', { name: /^Edit .*Temp Trialist$/ }));
    fireEvent.click(screen.getByRole('button', { name: /delete player/i }));
    await statusText(/Temp Trialist deleted/);
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/Delete .*Temp Trialist for good/));
    expect(must(await admin.from('players').select('id').eq('id', temp.id))).toEqual([]);
    expect(must(await admin.from('roster_memberships').select('id').eq('player_id', temp.id))).toEqual([]);
  }, 120000);

  it('a normal user using the same screen is refused and nothing is written', async () => {
    holder.client = normal.client;
    render(<ManageRosters />);
    await openTeam('Alpha');
    // No account is offered to a normal user, and the creator itself refuses them.
    const spare = await verifiedAccount('refused');
    type('New player email search', spare.email);
    await screen.findByText(/No verified account matches/, {}, { timeout: 15000 });
    expect(screen.queryByLabelText('New first name')).toBeNull();
    const direct = await normal.client.rpc('create_player_for_account', { p_user: spare.id, p_team_entry_id: made.entries.Alpha, p_first_name: `${tag}Refused`, p_last_name: 'User' });
    expect(direct.error?.code).toBe('42501');
    expect(must(await admin.from('players').select('id').eq('first_name', `${tag}Refused`))).toEqual([]);

    // Creating a team is refused as well, and no team is written.
    type('New team name', `${tag} Refused FC`);
    fireEvent.click(screen.getByRole('button', { name: /create team/i }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/only a dictator/i), { timeout: 15000 });
    expect(must(await admin.from('teams').select('id').eq('name', `${tag} Refused FC`))).toEqual([]);
  }, 60000);
});

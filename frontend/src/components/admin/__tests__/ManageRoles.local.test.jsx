// @vitest-environment jsdom
// Group: auth-roles. The real dictator flow for roles and assignments: Access control, Captains and Scorers, driven
// like a person would, talk to a REAL Supabase Data API through a real supabase-js client signed in as a dictator, and
// every write is checked in the database. A normal user and a captain using the same screens are refused and nothing
// is written. (A captain editing team details is covered through the real route in tests/roles/team-details.)
//
// Targets (skipped unless one is chosen):
//   SL_LOCAL_SUPABASE=1     this repository's local stack only (127.0.0.1:54321); run by the auth-roles test group
//   SL_UI_TARGET=staging    the staging project only, with the same guards and synthetic sl-check- records as
//                           scripts/staging-checks.mjs (reads backend/.env.staging.local; refuses any other project)
// Sessions come from admin-generated one-time links (no password sign-in, no CAPTCHA, no email sent).
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
  },
}));

import ManageRoles from '../ManageRoles';
import ManageCaptains from '../ManageCaptains';
import ManageScorers from '../ManageScorers';
import { optionsOf, pick, trigger } from './listbox';
import { readToasts } from '../../ui/toastStore';

const toasted = (pattern) => waitFor(() => expect(readToasts().at(-1)?.description ?? readToasts().at(-1)?.title).toMatch(pattern), { timeout: 15000 });
const enabled = (label) => waitFor(() => expect(trigger(label).disabled).toBe(false), { timeout: 15000 });
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

async function signedInAs(role, label = role) {
  const email = `${tag}-ui-${label}@${DOMAIN}`;
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

async function seed() {
  const must = (r) => { if (r.error) throw new Error(`setup failed: ${JSON.stringify(r.error)}`); return r.data; };
  const division = must(await admin.from('divisions').insert({ visibility: 'public', slug: tag, name: `${tag} Division` }).select('id').single()).id;
  const season = must(await admin.from('seasons').insert({ visibility: 'public', division_id: division, slug: '2026', name: `${tag} 2026`, is_current: true }).select('id').single()).id;
  const teams = must(await admin.from('teams').insert([{ name: `${tag} Reds` }, { name: `${tag} Blues` }]).select('id'));
  const entries = must(await admin.from('team_entries').insert(teams.map((t) => ({ team_id: t.id, season_id: season }))).select('id, team_id'));
  const match = must(await admin.from('matches').insert({ home_team_id: teams[0].id, away_team_id: teams[1].id, season_id: season, status: 'scheduled', date: new Date(Date.now() + 86400000).toISOString() }).select('id').single()).id;
  return { division, season, teams: teams.map((t) => t.id), entries, match };
}
const grantsOf = async (id) => ((await admin.from('user_roles').select('role').eq('user_id', id)).data ?? []).map((r) => r.role).sort();

describe.skipIf(!TARGET)(`roles and assignments through the real Data API (${TARGET ?? 'skipped'})`, () => {
  let dictator; let normal; let captain; let scorer; let world;

  async function dictatorFinds(account, labelFragment) {
    fireEvent.change(screen.getByLabelText(/Find (captain for .+|scorer)/), { target: { value: labelFragment } });
    await waitFor(() => expect(trigger(account).textContent).toMatch(/Choose from the search results/), { timeout: 15000 });
  }

  beforeAll(async () => {
    conn = connection();
    admin = createClient(conn.url, conn.secret, opts);
    dictator = await signedInAs('dictator');
    normal = await signedInAs('default');
    captain = await signedInAs('captain');
    scorer = await signedInAs('default', 'default2');
    world = await seed();
  }, 90000);

  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  afterAll(async () => {
    if (!admin) return;
    await admin.from('matches').delete().eq('id', world?.match);
    await admin.from('team_entries').delete().eq('season_id', world?.season);
    await admin.from('teams').delete().in('id', world?.teams ?? []);
    await admin.from('seasons').delete().eq('id', world?.season);
    await admin.from('divisions').delete().eq('id', world?.division);
    for (const id of users) await admin.auth.admin.deleteUser(id);
  }, 60000);

  it('a dictator grants and removes a role in Access control, and the database holds it', async () => {
    holder.client = dictator.client;
    render(<ManageRoles currentUserId={dictator.id} />);
    const label = new RegExp(`${tag}-ui-default@`);
    fireEvent.change(screen.getByLabelText('Search accounts'), { target: { value: `${tag}-ui-default` } });
    const first = await screen.findAllByLabelText(new RegExp(`^Editor for .*${tag}-ui-default@`), {}, { timeout: 15000 });
    fireEvent.click(first[0]);
    await toasted(/Granted editor/);
    expect(await grantsOf(normal.id)).toEqual(['editor']);
    fireEvent.click(screen.getAllByLabelText(new RegExp(`^Editor for .*${tag}-ui-default@`))[0]);
    await toasted(/Removed editor/);
    expect(await grantsOf(normal.id)).toEqual([]);
    expect(label).toBeTruthy();
  }, 60000);

  it('a dictator assigns a captain, changes the captain, and revokes; the grant follows the last assignment', async () => {
    holder.client = dictator.client;
    render(<ManageCaptains />);
    await enabled('Division');
    await pick('Division', `${tag} Division`);
    await enabled('Season');
    await pick('Season', `${tag} 2026 (current)`);
    await enabled('Team');
    await pick('Team', `${tag} Reds`);
    const teamName = `${tag} Reds`;
    await waitFor(() => expect(screen.getByLabelText(`Find captain for ${teamName}`)).toBeTruthy(), { timeout: 15000 });
    await dictatorFinds(`New captain for ${teamName}`, `${tag}-ui-default`);
    await pick(`New captain for ${teamName}`, new RegExp(`${tag}-ui-default@`));
    fireEvent.click(screen.getByRole('button', { name: /assign captain/i }));
    await toasted(/is now the captain/);
    const entry = world.entries.find((e) => e.team_id === world.teams[0]).id;
    expect((await admin.from('captain_assignments').select('user_id').eq('team_entry_id', entry)).data).toEqual([{ user_id: normal.id }]);
    expect(await grantsOf(normal.id)).toEqual(['captain']);
    // Change the captain: the one assignment moves, and the previous captain loses only the captain grant.
    await waitFor(() => expect(screen.getByLabelText(`Find captain for ${teamName}`)).toBeTruthy(), { timeout: 15000 }); // the section reloads after each save
    await dictatorFinds(`New captain for ${teamName}`, `${tag}-ui-default`);
    await pick(`New captain for ${teamName}`, new RegExp(`${tag}-ui-default2@`));
    fireEvent.click(screen.getByRole('button', { name: /change captain/i }));
    await toasted(/is now the captain/);
    await waitFor(async () => expect((await admin.from('captain_assignments').select('user_id').eq('team_entry_id', entry)).data).toEqual([{ user_id: scorer.id }]), { timeout: 15000 });
    expect(await grantsOf(normal.id)).toEqual([]);
    globalThis.confirmAnswer = vi.fn(async () => true);
    fireEvent.click(await screen.findByRole('button', { name: /revoke captain/i }, { timeout: 15000 }));
    await toasted(/no longer the captain/);
    expect((await admin.from('captain_assignments').select('id').eq('team_entry_id', entry)).data).toEqual([]);
    expect(await grantsOf(scorer.id)).toEqual([]);
  }, 90000);

  it('a dictator assigns a scorer to one match and revokes it', async () => {
    holder.client = dictator.client;
    render(<ManageScorers />);
    await dictatorFinds('Scorer', `${tag}-ui-default`);
    await pick('Scorer', new RegExp(`${tag}-ui-default2@`));
    await pick('Division', `${tag} Division`);
    await enabled('Season');
    await pick('Season', `${tag} 2026 (current)`);
    await enabled('Match');
    await waitFor(async () => expect((await optionsOf('Match')).join()).toMatch(`${tag} Reds vs ${tag} Blues`), { timeout: 15000 });
    await pick('Match', new RegExp(`${tag} Reds vs ${tag} Blues`));
    fireEvent.click(screen.getByRole('button', { name: /assign scorer/i }));
    await toasted(/can now score that match/);
    expect((await admin.from('scorer_assignments').select('match_id, season_id').eq('user_id', scorer.id)).data).toEqual([{ match_id: world.match, season_id: null }]);
    expect(await grantsOf(scorer.id)).toEqual(['scorer']);
    // The assigned scorer can now update that match through the Data API (and no other data).
    const own = await scorer.client.from('matches').update({ minute: '5' }).eq('id', world.match).select('id');
    expect(own.data).toHaveLength(1);
    globalThis.confirmAnswer = vi.fn(async () => true);
    const row = (await screen.findAllByRole('listitem', {}, { timeout: 15000 })).find((li) => li.textContent.includes(`${tag}-ui-default2`));
    fireEvent.click(within(row).getByRole('button', { name: /revoke/i }));
    await toasted(/no longer scores/);
    expect(await grantsOf(scorer.id)).toEqual([]);
    const after = await scorer.client.from('matches').update({ minute: '6' }).eq('id', world.match).select('id');
    expect(after.data ?? []).toHaveLength(0);
  }, 90000);

  it('a normal user and a captain are refused every one of these writes and nothing changes', async () => {
    const before = await grantsOf(normal.id);
    for (const who of [normal, captain]) {
      expect((await who.client.from('user_roles').insert({ user_id: who.id, role: 'dictator' })).error).not.toBeNull();
      expect((await who.client.rpc('assign_captain', { p_entry: world.entries[0].id, p_user: who.id })).error?.code).toBe('42501');
      expect((await who.client.rpc('assign_scorer', { p_user: who.id, p_season: world.season, p_match: null })).error?.code).toBe('42501');
      expect((await who.client.from('matches').update({ minute: '9' }).eq('id', world.match).select('id')).data ?? []).toHaveLength(0);
    }
    expect(await grantsOf(normal.id)).toEqual(before);
    expect(await grantsOf(captain.id)).toEqual(['captain']);
  }, 60000);
});

// @vitest-environment jsdom
// Group: player-accounts. The dictator's account controls in Teams & Rosters through the real Data API: a dictator
// chooses a verified synthetic account by email and links it, through Division -> Season -> Team -> Player, to a
// player without an account (a seed player), then unlinks it in the player panel; the database holds exactly that link
// each time and the player is restored. Locally (where legacy fixtures can be written as the seed writes them) the
// dictator also links every ready match from the matching preview, and the seed's matches are restored afterwards. A
// captain using the same controls sees no matches and no accounts, and nothing changes.
//
// Targets (skipped unless one is chosen):
//   SL_LOCAL_SUPABASE=1     this repository's local stack only (127.0.0.1:54321); run by the player-accounts group
//   SL_UI_TARGET=staging    the staging project only, with the same guards and synthetic sl-check- records as
//                           scripts/staging-checks.mjs (reads backend/.env.staging.local; refuses any other project)
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// @ts-ignore plain ESM
import { loadEnvText, verifyTarget } from '../../../../../scripts/staging-checks.mjs';

const ROOT = resolve(__dirname, '../../../../..');
const TARGET = process.env.SL_UI_TARGET === 'staging' ? 'staging' : process.env.SL_LOCAL_SUPABASE === '1' ? 'local' : null;
const DOMAIN = 'iiitkottayam.ac.in';
const tag = `sl-check-${randomBytes(4).toString('hex')}`;
const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const holder = vi.hoisted(() => ({ client: null }));
vi.mock('../../../lib/supabase', () => ({ supabase: { from: (...a) => holder.client.from(...a), rpc: (...a) => holder.client.rpc(...a) } }));

import PlayerAccountLink from '../PlayerAccountLink';
import AccountMatches from '../AccountMatches';
import ManualLink from '../ManualLink';
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

async function signedInAs(label, role) {
  const email = `${tag}-${label}@${DOMAIN}`;
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
  return { id: data.user.id, email, client };
}

// The LOCAL database only: legacy rows written as the seed writes them (no request JWT).
function localSql(sql) {
  if (TARGET !== 'local') throw new Error('local fixtures are written only to the local database');
  const r = spawnSync('psql', [LOCAL_DB, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}
const linkOf = async (id) => {
  const { data, error } = await admin.from('players').select('user_id').eq('id', id).single();
  if (error) throw error;
  return data.user_id;
};
const typeSearch = async (label, text) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value: text } });
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
};

describe.skipIf(!TARGET)(`account links through the real Data API (${TARGET ?? 'skipped'})`, () => {
  let dictator;
  let captain;
  let target; // an unlinked seed player with a roster place: { player, entry, season, division, name }
  let account;

  beforeAll(async () => {
    conn = connection();
    admin = createClient(conn.url, conn.secret, opts);
    dictator = await signedInAs('dictator', 'dictator');
    captain = await signedInAs('captain', 'captain');
    account = await signedInAs('person', 'default');
    // A seed player without an account and without a waiting email, on a roster.
    const { data: keys } = await admin.from('player_link_keys').select('player_id');
    const waiting = new Set((keys ?? []).map((k) => k.player_id));
    const { data: places, error } = await admin.from('roster_memberships')
      .select('player_id, team_entry_id, season_id, season:seasons ( division_id ), player:players!inner ( first_name, last_name, user_id )')
      .is('player.user_id', null).limit(50);
    if (error) throw error;
    const place = places.find((p) => !waiting.has(p.player_id));
    if (!place) throw new Error('no unlinked seed player on a roster to link');
    target = { player: place.player_id, entry: place.team_entry_id, season: place.season_id, division: place.season.division_id, name: `${place.player.first_name} ${place.player.last_name}` };
  }, 90000);

  afterEach(cleanup);

  afterAll(async () => {
    if (!admin) return;
    // The seed player is left as it was: unlinked (unlinking keeps everything else).
    if (target && (await linkOf(target.player))) await dictator.client.rpc('unlink_player_account', { p_player: target.player });
    for (const id of users) await admin.auth.admin.deleteUser(id);
  }, 60000);

  it('a dictator links a verified account to a player found through the rosters, then unlinks it', async () => {
    holder.client = dictator.client;
    const onChanged = vi.fn();
    render(<ManualLink onChanged={onChanged} />);
    await typeSearch('Manual email search', account.email);
    const list = await screen.findByRole('list', { name: 'Manual matches' }, { timeout: 10000 });
    fireEvent.click(within(list).getByRole('button', { name: `Choose ${account.email}` }));
    const choose = async (label, value, optionCheck) => {
      await waitFor(() => expect(within(screen.getByLabelText(label)).getAllByRole('option').some(optionCheck)).toBe(true), { timeout: 10000 });
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    };
    await choose('Link division', target.division, (o) => o.value === target.division);
    await choose('Link season', target.season, (o) => o.value === target.season);
    await choose('Link team', target.entry, (o) => o.value === target.entry);
    await choose('Link player', target.player, (o) => o.value === target.player);
    fireEvent.click(screen.getByRole('button', { name: `Link ${target.name}` }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/is linked to .* in every season/), { timeout: 10000 });
    expect(await linkOf(target.player)).toBe(account.id);
    cleanup();

    const status = (await dictator.client.rpc('player_link_status', { p_player_ids: [target.player] })).data[0];
    expect(status).toMatchObject({ linked: true, email: account.email });
    globalThis.confirmAnswer = vi.fn(async () => true);
    render(<PlayerAccountLink player={{ id: target.player, first_name: target.name, last_name: '' }} status={status} />);
    fireEvent.click(screen.getByRole('button', { name: /unlink/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/no longer linked/), { timeout: 10000 });
    expect(await linkOf(target.player)).toBeNull();
  }, 60000);

  it.skipIf(TARGET !== 'local')('a dictator links every ready match from the preview (local fixtures; the seed is restored)', async () => {
    holder.client = dictator.client;
    const ready = await signedInAs('ready', 'default');
    // A legacy player waiting for that account's email, added after the account exists (as in production).
    const legacy = localSql(`WITH p AS (INSERT INTO public.players (first_name, last_name) VALUES ('${tag}', 'Waiting') RETURNING id)
      , k AS (INSERT INTO public.player_link_keys (player_id, email) SELECT id, '${ready.email.toLowerCase()}' FROM p) SELECT id FROM p`);
    const before = (await dictator.client.rpc('account_link_matches')).data.filter((m) => m.status === 'ready');
    const seedKeys = before.filter((m) => m.player_id !== legacy).map((m) => ({ player: m.player_id, email: m.email }));
    try {
      globalThis.confirmAnswer = vi.fn(async () => true);
      render(<AccountMatches />);
      const button = await screen.findByRole('button', { name: new RegExp(`Link all ${before.length} ready match`) }, { timeout: 10000 });
      expect(within(screen.getByRole('table', { name: 'Account matches' })).getByText(ready.email.toLowerCase())).toBeTruthy();
      fireEvent.click(button);
      await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(new RegExp(`${before.length} players? linked`)), { timeout: 10000 });
      expect(await linkOf(legacy)).toBe(ready.id);
    } finally {
      // Restore the seed's ready matches for other local checks; remove the fixture.
      for (const k of seedKeys) {
        await dictator.client.rpc('unlink_player_account', { p_player: k.player });
        localSql(`INSERT INTO public.player_link_keys (player_id, email) VALUES ('${k.player}', '${k.email}') ON CONFLICT DO NOTHING`);
      }
      localSql(`DELETE FROM public.players WHERE id = '${legacy}'`);
    }
  }, 60000);

  it('a captain sees no matches and finds no accounts; nothing changes', async () => {
    holder.client = captain.client;
    render(<AccountMatches />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded \(Only a dictator/), { timeout: 10000 });
    cleanup();
    render(<ManualLink />);
    await typeSearch('Manual email search', account.email);
    await waitFor(() => expect(screen.getByText(/No verified account matches/)).toBeTruthy(), { timeout: 10000 });
    expect((await captain.client.rpc('link_player_account', { p_player: target.player, p_user: account.id })).error?.code).toBe('42501');
    expect(await linkOf(target.player)).toBeNull();
  }, 60000);
});

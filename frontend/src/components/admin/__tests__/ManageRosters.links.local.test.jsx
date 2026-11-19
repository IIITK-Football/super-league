// @vitest-environment jsdom
// Group: player-accounts. The dictator's account-link controls through the real Data API: a dictator finds a verified
// synthetic account, links it to a synthetic player, unlinks it, and links it again through a clean import preview;
// the database holds exactly that link each time. A captain using the same controls is refused and nothing changes.
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
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// @ts-ignore plain ESM
import { loadEnvText, verifyTarget } from '../../../../../scripts/staging-checks.mjs';

const ROOT = resolve(__dirname, '../../../../..');
const TARGET = process.env.SL_UI_TARGET === 'staging' ? 'staging' : process.env.SL_LOCAL_SUPABASE === '1' ? 'local' : null;
const DOMAIN = 'iiitkottayam.ac.in';
const tag = `sl-check-${randomBytes(4).toString('hex')}`;

const holder = vi.hoisted(() => ({ client: null }));
vi.mock('../../../lib/supabase', () => ({ supabase: { from: (...a) => holder.client.from(...a), rpc: (...a) => holder.client.rpc(...a) } }));

import PlayerAccountLink from '../PlayerAccountLink';
import AccountLinkImport from '../AccountLinkImport';

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
let divisionId = null;

async function signedInAs(label, role) {
  const email = `${tag}-${label}@${DOMAIN}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: randomBytes(16).toString('hex'), email_confirm: true });
  if (error) throw error;
  users.push(data.user.id);
  const roleWrite = await admin.from('user_roles').upsert({ user_id: data.user.id, role }, { onConflict: 'user_id' });
  if (roleWrite.error) throw roleWrite.error;
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error) throw link.error;
  const client = createClient(conn.url, conn.publishable, opts);
  const verified = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' });
  if (verified.error) throw verified.error;
  return { id: data.user.id, email, client };
}

const linkOf = async (id) => {
  const { data, error } = await admin.from('players').select('user_id').eq('id', id).single();
  if (error) throw error;
  return data.user_id;
};

describe.skipIf(!TARGET)(`account links through the real Data API (${TARGET ?? 'skipped'})`, () => {
  let dictator;
  let captain;
  let fan;
  let playerId = null;

  beforeAll(async () => {
    conn = connection();
    admin = createClient(conn.url, conn.secret, opts);
    dictator = await signedInAs('dictator', 'dictator');
    captain = await signedInAs('captain', 'captain');
    fan = await signedInAs('fan', 'default');
    const created = await admin.from('players').insert({ first_name: tag, last_name: 'Linkable' }).select('id').single();
    if (created.error) throw created.error;
    playerId = created.data.id;
  }, 60000);

  afterEach(cleanup);

  afterAll(async () => {
    if (!admin) return;
    if (playerId) await admin.from('players').delete().eq('id', playerId);
    for (const id of users) await admin.auth.admin.deleteUser(id);
  }, 60000);

  const player = () => ({ id: playerId, first_name: tag, last_name: 'Linkable' });

  it('a dictator links a verified account found by email, then unlinks it', async () => {
    holder.client = dictator.client;
    const onChanged = vi.fn();
    const { rerender } = render(<PlayerAccountLink player={player()} status={{ linked: false }} onChanged={onChanged} />);
    fireEvent.change(screen.getByLabelText('Search accounts'), { target: { value: fan.email } });
    const list = await screen.findByRole('list', { name: 'Matching accounts' }, { timeout: 10000 });
    fireEvent.click(within(list).getByRole('button', { name: new RegExp(`Link .*${tag}-fan`) }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/is linked to/), { timeout: 10000 });
    expect(await linkOf(playerId)).toBe(fan.id);
    const status = await dictator.client.rpc('player_link_status', { p_player_ids: [playerId] });
    rerender(<PlayerAccountLink player={player()} status={status.data[0]} onChanged={onChanged} />);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /unlink/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/no longer linked/), { timeout: 10000 });
    expect(await linkOf(playerId)).toBeNull();
  }, 30000);

  it('a dictator links through a clean import preview', async () => {
    holder.client = dictator.client;
    render(<AccountLinkImport />);
    fireEvent.change(screen.getByLabelText('Account links file'), { target: { value: `player_id,email\n${playerId},${fan.email.toUpperCase()}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByRole('table', { name: 'Account links preview' }, { timeout: 10000 });
    expect(screen.getByText('Will be linked')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/1 player linked/), { timeout: 10000 });
    expect(await linkOf(playerId)).toBe(fan.id);
  }, 30000);

  it('a captain finds no accounts and cannot import; nothing changes', async () => {
    holder.client = captain.client;
    render(<PlayerAccountLink player={player()} status={{ linked: false }} />);
    fireEvent.change(screen.getByLabelText('Search accounts'), { target: { value: fan.email } });
    await waitFor(() => expect(screen.getByText(/No verified account matches/)).toBeTruthy(), { timeout: 10000 });
    cleanup();
    render(<AccountLinkImport />);
    fireEvent.change(screen.getByLabelText('Account links file'), { target: { value: `player_id,email\n${playerId},` } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Only a dictator/), { timeout: 10000 });
    const direct = await captain.client.rpc('unlink_player_account', { p_player: playerId });
    expect(direct.error?.code).toBe('42501');
    expect(await linkOf(playerId)).toBe(fan.id);
  }, 30000);
});

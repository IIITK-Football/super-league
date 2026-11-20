// @vitest-environment jsdom
// Group: player-accounts. "Your player card" through the real Data API: a dictator creates a player for a verified
// synthetic account; signed in as that player, the card shows the player and the change of preferred foot and the
// portrait removal are saved through update_my_player, leaving the rating and stats untouched. An account with no
// linked player sees how to get linked and has no form. (The portrait upload route is covered by the backend tests.)
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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// @ts-ignore plain ESM
import { loadEnvText, verifyTarget } from '../../../../scripts/staging-checks.mjs';

const ROOT = resolve(__dirname, '../../../..');
const TARGET = process.env.SL_UI_TARGET === 'staging' ? 'staging' : process.env.SL_LOCAL_SUPABASE === '1' ? 'local' : null;
const DOMAIN = 'iiitkottayam.ac.in';
const tag = `sl-check-${randomBytes(4).toString('hex')}`;

const holder = vi.hoisted(() => ({ client: null }));
vi.mock('../../lib/supabase', () => ({ supabase: {
  from: (...a) => holder.client.from(...a), rpc: (...a) => holder.client.rpc(...a), auth: { getSession: () => holder.client.auth.getSession() },
} }));

import MyPlayerCard from '../../components/players/MyPlayerCard';

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

describe.skipIf(!TARGET)(`your player card through the real Data API (${TARGET ?? 'skipped'})`, () => {
  let dictator;
  let linked;
  let unlinked;
  let playerId = null;
  const made = { division: null, season: null, team: null, entry: null };

  beforeAll(async () => {
    conn = connection();
    admin = createClient(conn.url, conn.secret, opts);
    dictator = await signedInAs('dictator', 'dictator');
    linked = await signedInAs('player', 'default');
    unlinked = await signedInAs('nobody', 'captain');
    // The player is created as the app creates players: for the person's verified account, by a dictator.
    const must = (r) => { if (r.error) throw r.error; return r.data; };
    made.division = must(await admin.from('divisions').insert({ slug: tag, name: `SL Check ${tag}` }).select('id').single()).id;
    made.season = must(await admin.from('seasons').insert({ division_id: made.division, slug: '2026', name: `${tag} 2026`, is_current: true }).select('id').single()).id;
    made.team = must(await admin.from('teams').insert({ name: `${tag} Self FC` }).select('id').single()).id;
    made.entry = must(await admin.from('team_entries').insert({ team_id: made.team, season_id: made.season }).select('id').single()).id;
    playerId = must(await dictator.client.rpc('create_player_for_account', {
      p_user: linked.id, p_team_entry_id: made.entry, p_first_name: tag, p_last_name: 'Self', p_overall_rating: 71,
      p_image_url: 'https://media.example/old.png', p_attributes: { stats: { Pace: { total: 82 } }, playStyle: 'Rapid', bio: { preferredFoot: 'Right' } },
    }));
  }, 60000);

  afterEach(cleanup);

  afterAll(async () => {
    if (!admin) return;
    if (made.season) await admin.from('roster_memberships').delete().eq('season_id', made.season);
    if (playerId) await admin.from('players').delete().eq('id', playerId);
    if (made.entry) await admin.from('team_entries').delete().eq('id', made.entry);
    if (made.team) await admin.from('teams').delete().eq('id', made.team);
    if (made.season) await admin.from('seasons').delete().eq('id', made.season);
    if (made.division) await admin.from('divisions').delete().eq('id', made.division);
    for (const id of users) await admin.auth.admin.deleteUser(id);
  }, 60000);

  it('a linked player changes their preferred foot and removes their portrait; nothing else changes', async () => {
    holder.client = linked.client;
    render(<MyPlayerCard />);
    const foot = await screen.findByLabelText('Preferred foot', {}, { timeout: 10000 });
    expect(foot.value).toBe('Right');
    expect(screen.getByText(/Email:/).textContent).toContain(linked.email); // the account's email, read-only
    fireEvent.change(foot, { target: { value: 'Both' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove portrait' }));
    fireEvent.click(screen.getByRole('button', { name: /save card/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/saved/), { timeout: 10000 });
    const { data } = await admin.from('players').select('image_url, overall_rating, attributes, first_name').eq('id', playerId).single();
    expect(data).toEqual({ image_url: null, overall_rating: 71, first_name: tag,
      attributes: { stats: { Pace: { total: 82 } }, playStyle: 'Rapid', bio: { preferredFoot: 'Both' } } });
  }, 30000);

  it('an account with no linked player sees how to get linked, and the database refuses a self-edit', async () => {
    holder.client = unlinked.client;
    render(<MyPlayerCard />);
    await waitFor(() => expect(screen.getByText(/No player is linked to your account/)).toBeTruthy(), { timeout: 10000 });
    expect(screen.queryByLabelText('Preferred foot')).toBeNull();
    const refused = await unlinked.client.rpc('update_my_player', { p_image_url: null, p_preferred_foot: 'Left' });
    expect(refused.error?.code).toBe('42501');
  }, 30000);
});

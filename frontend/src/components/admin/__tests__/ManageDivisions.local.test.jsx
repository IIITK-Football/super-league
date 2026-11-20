// @vitest-environment jsdom
// Group: divisions. The real dictator flow: the ManageDivisions component, driven like a person would, talks to a
// REAL Supabase Data API through a real supabase-js client signed in as a dictator, and every write is checked in
// the database. A normal user using the same screen is refused and nothing is written.
//
// Targets (skipped unless one is chosen):
//   SL_LOCAL_SUPABASE=1     this repository's local stack only (127.0.0.1:54321); run by the divisions test group
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

import ManageDivisions from '../ManageDivisions';

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

async function removeSyntheticDivisions() {
  const { data } = await admin.from('divisions').select('id').like('slug', `${tag}%`);
  const ids = (data ?? []).map((d) => d.id);
  if (!ids.length) return;
  const { data: seasons } = await admin.from('seasons').select('id').in('division_id', ids);
  const seasonIds = (seasons ?? []).map((s) => s.id);
  if (seasonIds.length) {
    await admin.from('season_sections').delete().in('season_id', seasonIds);
    await admin.from('seasons').delete().in('id', seasonIds);
  }
  await admin.from('divisions').delete().in('id', ids);
}

const type = (scope, label, value) => fireEvent.change(scope.getByLabelText(label), { target: { value } });
const statusText = async (re) => waitFor(() => expect(screen.getByRole('status').textContent).toMatch(re), { timeout: 15000 });

describe.skipIf(!TARGET)(`ManageDivisions through the real Data API (${TARGET ?? 'skipped'})`, () => {
  let dictator;
  let normal;

  beforeAll(async () => {
    conn = connection();
    admin = createClient(conn.url, conn.secret, opts);
    dictator = await signedInAs('dictator');
    normal = await signedInAs('default');
  }, 60000);

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (!admin) return;
    await removeSyntheticDivisions();
    for (const id of users) await admin.auth.admin.deleteUser(id);
    const left = await admin.from('divisions').select('id').like('slug', `${tag}%`);
    expect(left.data ?? []).toEqual([]);
  }, 60000);

  it('a dictator creates a division, a current season and configures a section, all persisted', async () => {
    holder.client = dictator.client;
    render(<ManageDivisions />);
    await waitFor(() => expect(screen.queryByText(/loading divisions/i)).toBeNull(), { timeout: 15000 });

    const divisionForm = screen.getByRole('form', { name: 'New division' });
    type(within(divisionForm), /division name/i, 'SL Check Inter');
    type(within(divisionForm), /^slug/i, tag);
    fireEvent.click(within(divisionForm).getByRole('button', { name: /add division/i }));
    await statusText(/created/);
    const division = await admin.from('divisions').select('id, name, visibility, created_by').eq('slug', tag).single();
    expect(division.data).toMatchObject({ name: 'SL Check Inter', visibility: 'public', created_by: dictator.id });

    const row = (await screen.findByDisplayValue('SL Check Inter', {}, { timeout: 15000 })).closest('li');
    fireEvent.click(within(row).getByRole('button', { name: /^seasons$/i }));
    await screen.findByText(/no seasons yet/i, {}, { timeout: 15000 });
    const seasonForm = screen.getByRole('form', { name: 'New season' });
    type(within(seasonForm), /season name/i, '2026');
    type(within(seasonForm), /season slug/i, '2026');
    type(within(seasonForm), /starts/i, '2026-08-01');
    type(within(seasonForm), /ends/i, '2026-12-15');
    fireEvent.click(within(seasonForm).getByRole('button', { name: /add season/i }));
    await statusText(/created with the default sections/);
    const season = await admin.from('seasons').select('id, starts_on, ends_on, status, is_current').eq('division_id', division.data.id).single();
    expect(season.data).toMatchObject({ starts_on: '2026-08-01', ends_on: '2026-12-15', status: 'planned', is_current: false });
    const types = await admin.from('section_types').select('key');
    const sections = await admin.from('season_sections').select('section_key').eq('season_id', season.data.id);
    expect(sections.data).toHaveLength(types.data.length);

    fireEvent.click(await screen.findByRole('button', { name: /make current/i }, { timeout: 15000 }));
    await statusText(/is now the current season/);
    expect((await admin.from('seasons').select('is_current').eq('id', season.data.id).single()).data.is_current).toBe(true);

    fireEvent.click(await screen.findByRole('button', { name: /^sections$/i }, { timeout: 15000 }));
    const list = await screen.findByRole('list', { name: 'Sections' }, { timeout: 15000 });
    const fantasy = within(list).getByLabelText('Fantasy enabled');
    fireEvent.click(fantasy);
    type(within(list), 'Fantasy settings', '{"note": "off for this season"}');
    fireEvent.click(within(fantasy.closest('li')).getByRole('button', { name: /save/i }));
    await statusText(/Fantasy saved/);
    const saved = await admin.from('season_sections').select('enabled, settings').eq('season_id', season.data.id).eq('section_key', 'fantasy').single();
    expect(saved.data).toEqual({ enabled: false, settings: { note: 'off for this season' } });

    const divisionRow = (await screen.findByDisplayValue('SL Check Inter', {}, { timeout: 15000 })).closest('li');
    fireEvent.click(within(divisionRow).getByRole('button', { name: /archive/i }));
    await statusText(/archived/);
    expect((await admin.from('divisions').select('archived_at').eq('id', division.data.id).single()).data.archived_at).toBeTruthy();

    // The division has a season, so deleting it is refused and explained; the data stays.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(within(screen.getByDisplayValue('SL Check Inter').closest('li')).getByRole('button', { name: /delete sl check inter/i }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/archive it instead/i), { timeout: 15000 });
    expect((await admin.from('seasons').select('id').eq('division_id', division.data.id)).data).toHaveLength(1);
  }, 90000);

  it('a normal user using the same screen is refused and nothing is written', async () => {
    holder.client = normal.client;
    render(<ManageDivisions />);
    await waitFor(() => expect(screen.queryByText(/loading divisions/i)).toBeNull(), { timeout: 15000 });
    const form = screen.getByRole('form', { name: 'New division' });
    type(within(form), /division name/i, 'SL Check Refused');
    type(within(form), /^slug/i, `${tag}-refused`);
    fireEvent.click(within(form).getByRole('button', { name: /add division/i }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/only a dictator/i), { timeout: 15000 });
    expect((await admin.from('divisions').select('id').eq('slug', `${tag}-refused`)).data).toEqual([]);
    // The archived synthetic division is not visible to a normal user either.
    expect(screen.queryByDisplayValue('SL Check Inter')).toBeNull();
  }, 60000);
});

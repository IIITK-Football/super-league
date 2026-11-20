// @vitest-environment jsdom
// Group: audit. The real dictator audit history flow: a dictator renames a synthetic division through the real Data
// API, then opens the Audit History view (a real supabase-js client signed in as that dictator) and finds the change
// with their email, filtered by table and by person. Names carry the run's tag: the history is append-only, so
// earlier runs' entries stay. A normal user using the same screen sees no history.
//
// Targets (skipped unless one is chosen):
//   SL_LOCAL_SUPABASE=1     this repository's local stack only (127.0.0.1:54321); run by the audit test group
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

import AuditHistory from '../AuditHistory';

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

async function signedInAs(role) {
  const email = `${tag}-audit-${role}@${DOMAIN}`;
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

describe.skipIf(!TARGET)(`AuditHistory through the real Data API (${TARGET ?? 'skipped'})`, () => {
  let dictator;
  let normal;

  beforeAll(async () => {
    conn = connection();
    admin = createClient(conn.url, conn.secret, opts);
    dictator = await signedInAs('dictator');
    normal = await signedInAs('default');
    const created = await dictator.client.from('divisions').insert({ slug: tag, name: `${tag} Audit` }).select('id').single();
    if (created.error) throw created.error;
    divisionId = created.data.id;
    const renamed = await dictator.client.from('divisions').update({ name: `${tag} Renamed` }).eq('id', divisionId).select('id');
    if (renamed.error || !renamed.data?.length) throw renamed.error ?? new Error('rename refused');
  }, 60000);

  afterEach(cleanup);

  afterAll(async () => {
    if (!admin) return;
    if (divisionId) await admin.from('divisions').delete().eq('id', divisionId);
    for (const id of users) await admin.auth.admin.deleteUser(id);
  }, 60000);

  it('a dictator finds their own change, filtered by table and by person', async () => {
    holder.client = dictator.client;
    render(<AuditHistory />);
    fireEvent.change(await screen.findByLabelText('Table'), { target: { value: 'divisions' } });
    await waitFor(() => expect(screen.getByText(`name: ${tag} Audit → ${tag} Renamed`)).toBeTruthy(), { timeout: 15000 });
    const entry = screen.getByText(`name: ${tag} Audit → ${tag} Renamed`).closest('li').parentElement.closest('li');
    await waitFor(() => expect(within(entry).getByText(dictator.email)).toBeTruthy(), { timeout: 15000 }); // the label comes from audit_actors (no name set, so the email)
    expect(within(entry).getByText('update')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Changed by'), { target: { value: dictator.id } });
    await waitFor(() => {
      const items = within(screen.getByRole('list', { name: 'Audit entries' })).getAllByText(dictator.email);
      expect(items.length).toBe(2); // the creation and the rename, nobody else's changes
    }, { timeout: 15000 });
  }, 60000);

  it('a normal user using the same screen sees no history', async () => {
    holder.client = normal.client;
    render(<AuditHistory />);
    expect(await screen.findByText(/no changes recorded yet/i, {}, { timeout: 15000 })).toBeTruthy();
  }, 60000);
});

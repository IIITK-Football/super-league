#!/usr/bin/env node
// Security and sign-in checks against the STAGING project (yecozsiccsfwphlmxozt) with SYNTHETIC accounts.
//
//   node scripts/staging-checks.mjs
//
// Reads backend/.env.staging.local (git-ignored): SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY,
// ALLOW_REMOTE_SUPABASE=true. It REFUSES any other project (production, local, unknown) before making a request. Accounts
// are created through the admin API already confirmed, so no email is sent; sessions are obtained from generated links
// (never emailed). Every synthetic account and row is removed at the end, even if a check fails or a request throws.
// Keys and passwords are never printed. What it cannot do: complete a Turnstile challenge or a Google login (those need
// a browser), and it does not test email delivery.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeAll } from './verify-rpc-closed.mjs';

export const STAGING_REF = 'yecozsiccsfwphlmxozt';
const DOMAIN = 'iiitkottayam.ac.in';
const PREFIX = 'sl-check-';

export function loadEnvText(text) {
  const env = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return env;
}

// Returns the reasons this configuration must not be used (empty = fine). Messages never contain a key.
export function verifyTarget(env) {
  const errors = [];
  let host = '';
  try {
    const u = new URL(env.SUPABASE_URL ?? '');
    host = u.host;
    if (u.protocol !== 'https:') errors.push('SUPABASE_URL must be an https address');
  } catch {
    errors.push('SUPABASE_URL is missing or not a valid address');
  }
  if (host && host !== `${STAGING_REF}.supabase.co`) errors.push(`SUPABASE_URL does not point at the staging project (${STAGING_REF}); production, local and other projects are refused`);
  if (env.ALLOW_REMOTE_SUPABASE !== 'true') errors.push('ALLOW_REMOTE_SUPABASE must be exactly "true" to run against a remote project');
  if (!(env.SUPABASE_PUBLISHABLE_KEY ?? '').startsWith('sb_publishable_')) errors.push('SUPABASE_PUBLISHABLE_KEY is missing or is not a publishable key');
  if (!(env.SUPABASE_SECRET_KEY ?? '').startsWith('sb_secret_')) errors.push('SUPABASE_SECRET_KEY is missing or is not a secret key');
  return errors;
}

const rand = (bytes = 12) => randomBytes(bytes).toString('hex');

export async function runChecks({ env, fetchImpl = fetch, log = console.log }) {
  const problems = verifyTarget(env);
  if (problems.length) throw new Error(`refusing to run: ${problems.join('; ')}`);

  const base = `https://${STAGING_REF}.supabase.co`;
  const SECRET = env.SUPABASE_SECRET_KEY;
  const PUBLISHABLE = env.SUPABASE_PUBLISHABLE_KEY;
  const results = [];
  const record = (name, status, detail = '') => {
    results.push({ name, status, detail });
    log(`${status.padEnd(4)} ${name}${detail ? ` - ${detail}` : ''}`);
  };

  // The secret key travels as `apikey` only (new-format keys are not JWTs); user-level calls use the publishable key.
  const call = async (path, { method = 'GET', key, token, body, prefer } = {}) => {
    const headers = { apikey: key, 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (prefer) headers.prefer = prefer;
    const res = await fetchImpl(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { status: res.status, data, ok: res.status >= 200 && res.status < 300 };
  };
  const admin = (path, opts) => call(path, { ...opts, key: SECRET });
  const anon = (path, opts) => call(path, { ...opts, key: PUBLISHABLE });
  const message = (r) => String(r.data?.message ?? r.data?.msg ?? r.data?.error_description ?? r.data?.code ?? `HTTP ${r.status}`);

  const created = [];
  const tag = `${PREFIX}${rand(4)}`;
  const makeUser = async (label) => {
    const email = `${tag}-${label}@${DOMAIN}`;
    const r = await admin('/auth/v1/admin/users', { method: 'POST', body: { email, password: rand(16), email_confirm: true } });
    if (!r.ok || !r.data?.id) throw new Error(`could not create synthetic account ${label} (${message(r)})`);
    created.push(r.data.id);
    return { id: r.data.id, email };
  };
  const setRole = (id, role) => admin('/rest/v1/user_roles?on_conflict=user_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { user_id: id, role } });
  const makeTeam = async (captain, name) => {
    const reg = await admin('/rest/v1/team_registrations', { method: 'POST', prefer: 'return=representation', body: { captain_id: captain.id, team_name: `SL CHECK ${name}`, division: 'freshers' } });
    if (!reg.ok) throw new Error(`could not create the ${name} team entry (${message(reg)})`);
    const mem = await admin('/rest/v1/team_members', {
      method: 'POST',
      prefer: 'return=representation',
      body: { registration_id: reg.data[0].id, name: `SL Check Player ${name}`, first_name: 'SL', last_name: `Check ${name}`, email: `${tag}-player-${name.toLowerCase()}@${DOMAIN}`, position: 'CM', jersey_number: 7, overall_rating: 60, attributes: {} },
    });
    if (!mem.ok) throw new Error(`could not create the ${name} player (${message(mem)})`);
    return { member: mem.data[0].id };
  };
  const session = async (user, type = 'magiclink') => {
    const link = await admin('/auth/v1/admin/generate_link', { method: 'POST', body: { type, email: user.email } });
    const hashed = link.data?.hashed_token;
    if (!link.ok || !hashed) throw new Error(`could not generate a ${type} link (${message(link)})`);
    const v = await anon('/auth/v1/verify', { method: 'POST', body: { type, token_hash: hashed } });
    if (!v.ok || !v.data?.access_token) throw new Error(`could not turn the ${type} link into a session (${message(v)})`);
    return v.data.access_token;
  };
  const rpc = (token, memberId, extra = {}) =>
    call('/rest/v1/rpc/captain_update_team_member', {
      method: 'POST',
      key: PUBLISHABLE,
      token,
      body: { p_member_id: memberId, p_position: 'ST', p_jersey_number: 9, p_overall_rating: 61, p_attributes: {}, p_email: null, p_image_url: null, ...extra },
    });
  const expectRefused = (name, r, pattern) => {
    if (r.ok) record(name, 'FAIL', 'the call was ALLOWED');
    else if (pattern.test(message(r))) record(name, 'PASS', message(r));
    else record(name, 'FAIL', `refused, but with an unexpected answer: ${message(r)}`);
  };

  // Remove synthetic accounts (identified by the unmistakable address prefix) left by an earlier aborted run.
  const sweep = async () => {
    const list = await admin('/auth/v1/admin/users?per_page=1000');
    for (const u of list.data?.users ?? []) {
      if (u.email?.startsWith(PREFIX) && u.email.endsWith(`@${DOMAIN}`)) await admin(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' });
    }
  };

  try {
    await sweep();

    const probe = await probeAll(base, PUBLISHABLE, fetchImpl);
    const open = probe.filter((p) => p.verdict !== 'closed');
    record('Anonymous callers cannot execute either overload (probe: CLOSED)', open.length ? 'FAIL' : 'PASS', probe.map((p) => `${p.overload} ${p.verdict}`).join(', '));

    const captainA = await makeUser('captain-a');
    const captainB = await makeUser('captain-b');
    const assigned = await makeUser('assigned-no-role');
    const normal = await makeUser('normal');
    const dictator = await makeUser('dictator');
    await setRole(captainA.id, 'captain');
    await setRole(captainB.id, 'captain');
    await setRole(assigned.id, 'default');
    await setRole(dictator.id, 'dictator');
    const teamA = await makeTeam(captainA, 'A');
    const teamB = await makeTeam(captainB, 'B');
    const teamC = await makeTeam(assigned, 'C');
    record('Synthetic test accounts and teams created (confirmed on creation, no mail is sent)', 'PASS', `${created.length} accounts`);

    const captcha = await anon('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: normal.email, password: 'wrong-on-purpose' } });
    if (captcha.ok) record('Password sign-in without a Turnstile token is rejected (CAPTCHA enforced)', 'FAIL', 'sign-in was accepted without a CAPTCHA token');
    else if (/captcha/i.test(JSON.stringify(captcha.data ?? {}))) record('Password sign-in without a Turnstile token is rejected (CAPTCHA enforced)', 'PASS', message(captcha));
    else record('Password sign-in without a Turnstile token is rejected (CAPTCHA enforced)', 'FAIL', `rejected, but not by CAPTCHA: ${message(captcha)}`);

    const tokenA = await session(captainA);
    const own = await rpc(tokenA, teamA.member);
    const readBack = own.ok ? await admin(`/rest/v1/team_members?id=eq.${teamA.member}&select=jersey_number,position`) : null;
    const saved = readBack?.data?.[0]?.jersey_number === 9;
    record('A captain can save a player on their own team', own.ok && saved ? 'PASS' : 'FAIL', own.ok ? (saved ? 'saved and read back' : 'accepted but the change is not there') : message(own));

    expectRefused('A captain cannot change a player on another team', await rpc(tokenA, teamB.member), /not part of your assigned roster/i);
    expectRefused("A captain cannot change a player's email", await rpc(tokenA, teamA.member, { p_email: `${tag}-other@${DOMAIN}` }), /only a dictator can change/i);
    expectRefused('An assigned user without the captain role is refused', await rpc(await session(assigned), teamC.member), /captain access is required/i);
    expectRefused('A normal user cannot change a player', await rpc(await session(normal), teamA.member), /not part of your assigned roster/i);

    const dict = await rpc(await session(dictator), teamB.member, { p_jersey_number: 11 });
    record('A dictator can update a player on any team', dict.ok ? 'PASS' : 'FAIL', dict.ok ? 'accepted' : message(dict));

    // Recovery: the one-time token flow, without sending any mail (this does not test email delivery or redirect URLs).
    const recoveryToken = await session(normal, 'recovery');
    const reset = await call('/auth/v1/user', { method: 'PUT', key: PUBLISHABLE, token: recoveryToken, body: { password: rand(16) } });
    record('Password recovery token flow works (a recovery session can set a new password; no mail is sent)', reset.ok ? 'PASS' : 'FAIL', reset.ok ? 'password updated' : message(reset));
  } catch (e) {
    record('Run completed without an unexpected error', 'FAIL', String(e.message ?? e).slice(0, 200));
  } finally {
    try {
      for (const id of created) await admin(`/auth/v1/admin/users/${id}`, { method: 'DELETE' });
      await sweep();
      const gone = [];
      for (const id of created) gone.push((await admin(`/auth/v1/admin/users/${id}`)).status === 404);
      const ids = created.join(',');
      const leftoverRegs = created.length ? (await admin(`/rest/v1/team_registrations?captain_id=in.(${ids})&select=id`)).data ?? [] : [];
      const leftoverRoles = created.length ? (await admin(`/rest/v1/user_roles?user_id=in.(${ids})&select=user_id`)).data ?? [] : [];
      const clean = gone.every(Boolean) && leftoverRegs.length === 0 && leftoverRoles.length === 0;
      record('Cleanup removed every synthetic account and row', clean ? 'PASS' : 'FAIL', `${created.length} accounts removed; ${leftoverRegs.length} team entries and ${leftoverRoles.length} role rows left over`);
    } catch (e) {
      record('Cleanup removed every synthetic account and row', 'FAIL', `cleanup error: ${String(e.message ?? e).slice(0, 160)} (accounts are prefixed ${PREFIX} and removed by the next run)`);
    }
  }
  return results;
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const file = join(root, 'backend/.env.staging.local');
  if (!existsSync(file)) {
    console.error('backend/.env.staging.local is missing (see docs/release.md). Nothing was run.');
    return 2;
  }
  const env = loadEnvText(readFileSync(file, 'utf8'));
  console.log(`Target: the staging project (${STAGING_REF}). Production and local are refused.`);
  let results;
  try {
    results = await runChecks({ env });
  } catch (e) {
    console.error(String(e.message ?? e));
    return 2;
  }
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(failed === 0 ? `\nRESULT: PASSED (${results.length} checks)` : `\nRESULT: FAILED (${failed} of ${results.length})`);
  console.log('Not covered here (need a browser): a Turnstile challenge with a valid token, a real Google login, and email delivery.');
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main());

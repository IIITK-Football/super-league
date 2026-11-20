#!/usr/bin/env node
// End-to-end media upload check against STAGING, through the real staging site (Pages → /api → API Worker → R2
// bindings), behind Cloudflare Access.
//
//   node scripts/staging-media-check.mjs
//
// - Supabase: reads backend/.env.staging.local (git-ignored) and refuses any project but staging (verifyTarget from
//   staging-checks.mjs). Synthetic accounts are created through the admin API and removed at the end.
// - Cloudflare Access: a service token from the macOS Keychain (services sl-staging-access-client-id and
//   sl-staging-access-client-secret) or from the environment (CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET).
// - Site: STAGING_SITE_URL, default https://develop.super-league.pages.dev; only *.super-league.pages.dev preview hosts
//   are accepted, never the production host.
// It uploads a portrait, a team logo and a news image, checks each returned URL is a staging bucket URL serving a PNG,
// checks a normal account is refused a news upload, and restores the team's logo. Keys and tokens are never printed.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { loadEnvText, STAGING_REF, verifyTarget } from './staging-checks.mjs';

const PRODUCTION_SITE = 'super-league.pages.dev';
export const STAGING_MEDIA_HOSTS = [
  'pub-c999a250934d4712a25333ceff10c73b.r2.dev', // sl-staging-news-images
  'pub-b62195e579bd4e96b5b0c15cb5e55bb7.r2.dev', // sl-staging-player-images
  'pub-489c77c12df044fc9c0f0ce27758deca.r2.dev', // sl-staging-team-logos
];

export function verifySite(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return ['STAGING_SITE_URL is not a URL'];
  }
  const errors = [];
  if (url.protocol !== 'https:') errors.push('STAGING_SITE_URL must use https');
  if (url.host === PRODUCTION_SITE || !url.host.endsWith(`.${PRODUCTION_SITE}`)) errors.push('STAGING_SITE_URL must be a preview host (*.super-league.pages.dev), never production');
  return errors;
}

export function accessHeaders(env = process.env, keychain = readKeychain) {
  const id = env.CF_ACCESS_CLIENT_ID || keychain('sl-staging-access-client-id');
  const secret = env.CF_ACCESS_CLIENT_SECRET || keychain('sl-staging-access-client-secret');
  if (!id || !secret) throw new Error('No Cloudflare Access service token: add it to the Keychain (see docs/worker-staging.md)');
  return { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret };
}

function readKeychain(service) {
  try {
    return execFileSync('security', ['find-generic-password', '-s', service, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

// A valid solid-colour PNG of the given size (portraits are 500 x 500, logos 256 x 256).
export function png(size) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((size * 3 + 1) * size, 0x40);
  for (let y = 0; y < size; y++) raw[y * (size * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export function isStagingMediaUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && STAGING_MEDIA_HOSTS.includes(u.host);
  } catch {
    return false;
  }
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const envFile = join(root, 'backend/.env.staging.local');
  if (!existsSync(envFile)) throw new Error('backend/.env.staging.local is missing');
  const env = loadEnvText(readFileSync(envFile, 'utf8'));
  const problems = [...verifyTarget(env), ...verifySite(process.env.STAGING_SITE_URL || `https://develop.${PRODUCTION_SITE}`)];
  if (problems.length) throw new Error(`refusing to run: ${problems.join('; ')}`);
  const site = (process.env.STAGING_SITE_URL || `https://develop.${PRODUCTION_SITE}`).replace(/\/+$/, '');
  const access = accessHeaders();

  const base = `https://${STAGING_REF}.supabase.co`;
  const adminHeaders = { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' };
  const rest = async (path, init = {}) => {
    const r = await fetch(`${base}${path}`, { ...init, headers: { ...adminHeaders, ...(init.headers || {}) } });
    const text = await r.text();
    return { ok: r.ok, status: r.status, data: text ? JSON.parse(text) : null };
  };

  const made = [];
  let restoreLogo = null;
  const results = [];
  const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`); };

  async function account(label, role) {
    const email = `sl-check-media-${label}-${randomBytes(4).toString('hex')}@iiitkottayam.ac.in`;
    const u = await rest('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password: randomBytes(16).toString('hex'), email_confirm: true }) });
    if (!u.ok) throw new Error(`could not create the ${label} account (${u.status})`);
    made.push(u.data.id);
    if (role) {
      const g = await rest('/rest/v1/user_roles', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: u.data.id, role }) });
      if (!g.ok) throw new Error(`could not grant ${role} (${g.status})`);
    }
    const link = await rest('/auth/v1/admin/generate_link', { method: 'POST', body: JSON.stringify({ type: 'magiclink', email }) });
    const v = await fetch(`${base}/auth/v1/verify`, { method: 'POST', headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: link.data?.hashed_token }) });
    const session = await v.json();
    if (!session.access_token) throw new Error(`could not sign in the ${label} account`);
    return session.access_token;
  }

  const api = async (path, token, form) => {
    const r = await fetch(`${site}/api${path}`, { method: 'POST', headers: { ...access, Authorization: `Bearer ${token}` }, body: form, redirect: 'manual' });
    if (r.status >= 300 && r.status < 400) throw new Error('Cloudflare Access refused the service token (redirected to sign-in)');
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const servesPng = async (url) => {
    const r = await fetch(url);
    const b = new Uint8Array(await r.arrayBuffer());
    return r.ok && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  };

  try {
    const health = await fetch(`${site}/api/health`, { headers: access, redirect: 'manual' });
    const h = await health.json().catch(() => ({}));
    check('site reaches the staging API Worker through Access', health.status === 200 && h.environment === 'staging');

    const dictator = await account('dictator', 'dictator');
    const normal = await account('normal');
    const place = (await rest('/rest/v1/roster_memberships?select=id,team_entry_id&limit=1')).data?.[0];
    const entry = (await rest(`/rest/v1/team_entries?select=id,team_id,teams(logo_url,team_color)&id=eq.${place.team_entry_id}`)).data?.[0];
    restoreLogo = { teamId: entry.team_id, logo_url: entry.teams.logo_url };

    let f = new FormData();
    f.set('membership_id', place.id); f.set('image', new File([png(500)], 'portrait.png', { type: 'image/png' }));
    const portrait = await api('/admin/freshers/player-image', dictator, f);
    check('portrait upload stored in the staging players bucket', portrait.status === 200 && isStagingMediaUrl(portrait.body.imageUrl), `status ${portrait.status}`);
    if (portrait.body.imageUrl) check('portrait URL serves the PNG', await servesPng(portrait.body.imageUrl));

    f = new FormData();
    f.set('team_entry_id', entry.id); f.set('team_color', entry.teams.team_color || '#123456'); f.set('logo', new File([png(256)], 'logo.png', { type: 'image/png' }));
    const logo = await api('/captain/team-branding', dictator, f);
    const logoUrl = logo.body.data?.logo_url?.split('?')[0];
    check('team logo upload stored in the staging logos bucket', logo.status === 200 && isStagingMediaUrl(logoUrl), `status ${logo.status}`);
    if (logoUrl) check('team logo URL serves the PNG', await servesPng(logoUrl));

    f = new FormData();
    f.set('image', new File([png(64)], 'news.png', { type: 'image/png' }));
    const news = await api('/admin/newsletter/image', dictator, f);
    check('news image upload stored in the staging news bucket', news.status === 200 && isStagingMediaUrl(news.body.publicUrl), `status ${news.status}`);
    if (news.body.publicUrl) check('news image URL serves the PNG', await servesPng(news.body.publicUrl));

    f = new FormData();
    f.set('image', new File([png(64)], 'news.png', { type: 'image/png' }));
    check('a normal account is refused a news upload', (await api('/admin/newsletter/image', normal, f)).status === 403);
  } finally {
    if (restoreLogo) await rest(`/rest/v1/teams?id=eq.${restoreLogo.teamId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ logo_url: restoreLogo.logo_url }) });
    for (const id of made) await rest(`/auth/v1/admin/users/${id}`, { method: 'DELETE' });
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} of ${results.length} passed`);
  if (failed) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(`staging media check failed: ${error.message}`); process.exit(1); });
}

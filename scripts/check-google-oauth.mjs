#!/usr/bin/env node
// Read-only check of where Google sign-in would send the browser for a Supabase project.
//
//   node scripts/check-google-oauth.mjs <project-url>
//   node scripts/check-google-oauth.mjs http://127.0.0.1:54321        (local)
//
// It requests the project's PUBLIC /auth/v1/authorize?provider=google endpoint (no key, no login; the same
// request the browser makes) WITHOUT following the redirect, and reports:
//   - whether Google sign-in is enabled on that project,
//   - the SHAPE of the client id Google would receive ("real-shaped", "placeholder", "missing"), never its value,
//   - whether the callback address Google is told to return to belongs to the same project host.
// Nothing is written and no credential is read or printed.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const PLACEHOLDER = 'google-not-configured';

function clientIdShape(id) {
  if (!id) return 'missing';
  if (id === PLACEHOLDER) return 'placeholder';
  if (/\.apps\.googleusercontent\.com$/.test(id)) return 'real-shaped';
  return 'unexpected';
}

// Pure: turns what /authorize answered into a verdict. Never returns the client id itself.
export function analyze(projectUrl, status, location, body) {
  if (status >= 300 && status < 400 && location) {
    let target;
    try {
      target = new URL(location);
    } catch {
      return { verdict: 'inconclusive', reason: 'unreadable redirect address' };
    }
    if (target.host !== 'accounts.google.com') return { verdict: 'inconclusive', reason: `redirected to ${target.host}, not Google` };
    const clientId = clientIdShape(target.searchParams.get('client_id'));
    const redirectUri = target.searchParams.get('redirect_uri');
    let callbackHost = null;
    try {
      callbackHost = redirectUri ? new URL(redirectUri).host : null;
    } catch {
      callbackHost = null;
    }
    const callbackMatchesProject = callbackHost !== null && callbackHost === new URL(projectUrl).host;
    let verdict = 'ready';
    if (clientId === 'placeholder' || clientId === 'missing') verdict = 'placeholder-client';
    else if (clientId === 'unexpected') verdict = 'unexpected-client';
    else if (!callbackMatchesProject) verdict = 'callback-mismatch';
    return { verdict, clientId, callbackMatchesProject, callbackHost };
  }
  if (status >= 400 && status < 500 && /not enabled|unsupported provider/i.test(String(body))) return { verdict: 'disabled' };
  return { verdict: 'inconclusive', reason: status ? `HTTP ${status}` : 'no response' };
}

export async function checkGoogle(projectUrl, fetchImpl = fetch) {
  const base = projectUrl.replace(/\/+$/, '');
  try {
    const res = await fetchImpl(`${base}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(`${base}/`)}`, {
      redirect: 'manual',
    });
    const body = res.status >= 400 ? await res.text() : '';
    return analyze(base, res.status, res.headers.get('location'), body);
  } catch {
    return { verdict: 'inconclusive', reason: 'no response' };
  }
}

const EXPLAIN = {
  ready: 'READY. Google is enabled, the client id looks real, and the callback belongs to this project.',
  disabled: 'DISABLED. Google sign-in is switched off on this project; the app shows "not set up".',
  'placeholder-client': 'BROKEN. Google is enabled with a placeholder or missing client id; users will see Google "Error 401: invalid_client".',
  'unexpected-client': 'CHECK. Google is enabled but the client id does not look like a Google web client id.',
  'callback-mismatch': 'CHECK. The callback address Google returns to is on a different host than this project.',
  inconclusive: 'INCONCLUSIVE. Could not read the answer; check the project URL.',
};

async function main(argv) {
  const [url] = argv;
  if (!url || !/^https?:\/\//.test(url)) {
    console.error('usage: node scripts/check-google-oauth.mjs <project-url>');
    return 2;
  }
  const r = await checkGoogle(url);
  if (r.clientId) console.log(`client id shape: ${r.clientId}`);
  if (r.callbackHost) console.log(`callback host:   ${r.callbackHost} (${r.callbackMatchesProject ? 'same as project' : 'DIFFERENT from project'})`);
  if (r.reason) console.log(`detail: ${r.reason}`);
  console.log(`RESULT: ${EXPLAIN[r.verdict]}`);
  return r.verdict === 'ready' || r.verdict === 'disabled' ? 0 : r.verdict === 'inconclusive' ? 2 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));

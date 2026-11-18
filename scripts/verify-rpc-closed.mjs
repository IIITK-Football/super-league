#!/usr/bin/env node
// Confirms that the captain roster functions cannot be called by an ANONYMOUS caller on a Supabase project:
// captain_update_roster_player must refuse anonymous callers, and the retired captain_update_team_member overloads
// must refuse them too or, once retired (20261125000000), no longer exist.
//
//   node scripts/verify-rpc-closed.mjs <project-url> <publishable-key>
//
// It calls the function through the public API with only the publishable key (the same key every visitor's
// browser holds) and a RANDOM roster place id that matches no player, so nothing can be changed even if the
// function were open. A closed function answers "permission denied" (code 42501). The key is sent only as
// the apikey header and is never printed. Use the project URL and publishable key from the dashboard
// (Project Settings -> API); the publishable key is public by design.
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function classify(status, body) {
  let parsed = body;
  if (typeof body === 'string') {
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      parsed = {};
    }
  }
  const code = parsed?.code;
  const message = String(parsed?.message ?? '');
  if ((status === 401 || status === 403) && (code === '42501' || /permission denied/i.test(message))) return 'closed';
  // Not an answer about the function: wrong key, function not found, unreachable, server trouble.
  if (status === 0 || status === 404 || status >= 500 || code === 'PGRST202' || status === 401 || status === 403) return 'inconclusive';
  // Anything else means the function ran: a success, or an error raised inside it.
  return 'open';
}

const randomBody = (extra) => ({ p_position: null, p_jersey_number: null, p_overall_rating: 50, p_attributes: {}, ...extra });

// The current function, then the two retired overloads. A retired overload that no longer exists is closed.
const PROBES = [
  { overload: 'roster player', fn: 'captain_update_roster_player', retired: false, body: () => randomBody({ p_membership_id: randomUUID(), p_image_url: null }) },
  { overload: '7-argument (retired)', fn: 'captain_update_team_member', retired: true, body: () => randomBody({ p_member_id: randomUUID(), p_email: null, p_image_url: null }) },
  { overload: '5-argument (retired)', fn: 'captain_update_team_member', retired: true, body: () => randomBody({ p_member_id: randomUUID() }) },
];

export async function probeAll(url, key, fetchImpl = fetch) {
  const results = [];
  for (const { overload, fn, retired, body } of PROBES) {
    let status = 0;
    let text = '';
    try {
      const res = await fetchImpl(`${url.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: key, 'content-type': 'application/json' },
        body: JSON.stringify(body()), // a random id that matches no player: harmless even if the function is open
      });
      status = res.status;
      text = await res.text();
    } catch {
      status = 0;
    }
    let verdict = classify(status, text);
    if (retired && verdict === 'inconclusive' && isMissingFunction(status, text)) verdict = 'retired';
    results.push({ overload, verdict, status });
  }
  return results;
}

// PostgREST answers PGRST202 (HTTP 404) when no function matches the name and arguments.
export function isMissingFunction(status, body) {
  try {
    return status === 404 && JSON.parse(body || '{}').code === 'PGRST202';
  } catch {
    return false;
  }
}

async function main(argv) {
  const [url, key] = argv;
  if (!url || !key || !/^https?:\/\//.test(url)) {
    console.error('usage: node scripts/verify-rpc-closed.mjs <project-url> <publishable-key>');
    return 2;
  }
  const results = await probeAll(url, key);
  for (const r of results) console.log(`${r.overload} overload: ${r.verdict.toUpperCase()} (HTTP ${r.status || 'no response'})`);
  if (results.some((r) => r.verdict === 'open')) {
    console.log('RESULT: OPEN. Anonymous callers can still reach the function. Do not treat the fix as complete.');
    return 1;
  }
  if (results.some((r) => r.verdict === 'inconclusive')) {
    console.log('RESULT: INCONCLUSIVE. Check the project URL and publishable key, then run it again.');
    return 2;
  }
  console.log('RESULT: CLOSED. Anonymous callers are refused by the roster function, and the retired overloads are closed or gone.');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));

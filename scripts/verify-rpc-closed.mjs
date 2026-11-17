#!/usr/bin/env node
// Confirms that captain_update_team_member cannot be called by an ANONYMOUS caller on a Supabase project.
//
//   node scripts/verify-rpc-closed.mjs <project-url> <publishable-key>
//
// It calls the function through the public API with only the publishable key (the same key every visitor's
// browser holds) and a RANDOM player id that matches no player, so nothing can be changed even if the
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

const OVERLOADS = [
  { overload: '7-argument', extra: { p_email: null, p_image_url: null } },
  { overload: '5-argument', extra: {} },
];

export async function probeAll(url, key, fetchImpl = fetch) {
  const results = [];
  for (const { overload, extra } of OVERLOADS) {
    let status = 0;
    let body = '';
    try {
      const res = await fetchImpl(`${url.replace(/\/+$/, '')}/rest/v1/rpc/captain_update_team_member`, {
        method: 'POST',
        headers: { apikey: key, 'content-type': 'application/json' },
        body: JSON.stringify({
          p_member_id: randomUUID(), // matches no player: harmless even if the function is open
          p_position: null,
          p_jersey_number: null,
          p_overall_rating: 50,
          p_attributes: {},
          ...extra,
        }),
      });
      status = res.status;
      body = await res.text();
    } catch {
      status = 0;
    }
    results.push({ overload, verdict: classify(status, body), status });
  }
  return results;
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
  console.log('RESULT: CLOSED. Anonymous callers are refused on both overloads.');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));

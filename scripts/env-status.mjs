#!/usr/bin/env node
// Reports which environment variables are configured, BY NAME ONLY: each variable is "set", "empty" or "missing" per file.
// It never prints, returns or logs a value, so it is safe to run and to paste the output. Local and staging files only;
// production and the backup project are deliberately not listed.
//
//   node scripts/env-status.mjs
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TARGETS = [
  { scope: 'local', file: 'backend/.env.local', purpose: 'backend API against the local stack', vars: ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY'] },
  { scope: 'local', file: 'frontend/.env.local', purpose: 'frontend against the local stack', vars: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_API_URL', 'VITE_TURNSTILE_SITE_KEY'] },
  { scope: 'local', file: 'frontend/.dev.vars', purpose: 'Pages Functions (share previews) locally', vars: ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'] },
  { scope: 'local', file: 'backend/supabase/.env', purpose: 'local Supabase Auth (Google sign-in, Turnstile secret)', vars: ['SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID', 'SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET', 'SUPABASE_AUTH_CAPTCHA_SECRET'] },
  { scope: 'staging', file: 'frontend/.env.staging.local', purpose: 'frontend against the staging project (vite --mode staging)', vars: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_ALLOW_REMOTE_SUPABASE', 'VITE_TURNSTILE_SITE_KEY'] },
  { scope: 'staging', file: 'backend/.env.staging.local', purpose: 'scripted staging checks (synthetic accounts, anonymous probe)', vars: ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'ALLOW_REMOTE_SUPABASE'] },
];

// Returns name -> "set" | "empty" for the variables defined in an env file. Values are discarded immediately.
function parse(text) {
  const out = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const value = m[2].trim().replace(/^(["'])(.*)\1$/, '$2');
    out.set(m[1], value === '' ? 'empty' : 'set');
  }
  return out;
}

export function envStatus(root = resolve(dirname(), '..')) {
  return TARGETS.map((t) => {
    const path = join(root, t.file);
    const exists = existsSync(path);
    const defined = exists ? parse(readFileSync(path, 'utf8')) : new Map();
    const others = [...defined.keys()].filter((n) => !t.vars.includes(n));
    return { scope: t.scope, file: t.file, purpose: t.purpose, exists, others, vars: t.vars.map((name) => ({ name, state: defined.get(name) ?? 'missing' })) };
  });
}

function dirname() {
  return resolve(fileURLToPath(import.meta.url), '..');
}

export function formatStatus(status) {
  const lines = [];
  for (const scope of ['local', 'staging']) {
    lines.push(`## ${scope}`);
    for (const t of status.filter((s) => s.scope === scope)) {
      lines.push(`${t.file}  (${t.exists ? 'file exists' : 'FILE MISSING'}): ${t.purpose}`);
      for (const v of t.vars) lines.push(`    ${v.state.padEnd(8)} ${v.name}`);
      if (t.others.length) lines.push(`    other names: ${t.others.join(', ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(formatStatus(envStatus()));
}

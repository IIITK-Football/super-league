// Test helper: connects to THIS repository's local Supabase stack only (127.0.0.1:54321).
import { spawnSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const MAILPIT = 'http://127.0.0.1:54324';

type Keys = { url: string; anon: string; service: string };

export function localKeys(): Keys {
  const r = spawnSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], { encoding: 'utf8', cwd: `${__dirname}/../..` });
  if (r.status !== 0) throw new Error('Local Supabase is not running. Start it with: pnpm db:start');
  const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  if (out.API_URL !== 'http://127.0.0.1:54321') throw new Error('Refusing to run: API is not the local stack on 127.0.0.1:54321');
  return { url: out.API_URL, anon: out.ANON_KEY, service: out.SERVICE_ROLE_KEY };
}

export function clients(keys: Keys): { anon: () => SupabaseClient; admin: SupabaseClient } {
  const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  return {
    anon: () => createClient(keys.url, keys.anon, opts),
    admin: createClient(keys.url, keys.service, opts),
  };
}

export const uniqueEmail = (label: string, domain = 'iiitkottayam.ac.in') =>
  `authtest.${label}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@${domain}`;

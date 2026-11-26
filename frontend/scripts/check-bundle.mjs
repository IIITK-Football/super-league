#!/usr/bin/env node
// Scans a build for elevated Supabase key formats: by default the built frontend (dist/), or any directory given as
// the first argument (the Worker build: `pnpm --dir api build`, then `node frontend/scripts/check-bundle.mjs api/dist`).
//   pnpm --filter ./frontend build && node frontend/scripts/check-bundle.mjs
// Reports only the kind of key found and the file, never the key itself.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SECRET = /sb_secret_[A-Za-z0-9_-]{16,}/;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;

export function findElevatedKeys(text) {
  const hits = [];
  if (SECRET.test(text)) hits.push({ kind: 'secret key (sb_secret_)' });
  for (const m of text.matchAll(JWT)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
      if (payload?.role === 'service_role') hits.push({ kind: 'legacy service_role key (JWT)' });
    } catch {
      // not a decodable JWT: ignore
    }
  }
  return hits;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|mjs|css|html|map|json)$/.test(name)) out.push(p);
  }
  return out;
}

function main() {
  const dist = process.argv[2] ? resolve(process.argv[2]) : resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
  let files;
  try {
    files = walk(dist);
  } catch {
    console.error(`check-bundle: no build found at ${dist}. Run the build first.`);
    return 2;
  }
  let bad = 0;
  for (const f of files) {
    for (const hit of findElevatedKeys(readFileSync(f, 'utf8'))) {
      console.error(`check-bundle: ${hit.kind} found in ${relative(dist, f)}`);
      bad += 1;
    }
  }
  if (bad) {
    console.error('The frontend bundle contains an elevated Supabase key. Remove it from every VITE_ variable and rebuild.');
    return 1;
  }
  console.log(`check-bundle: ${files.length} built files scanned, no elevated keys found.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());

// Group: config. Tracked .env.example files must be safe to copy and publish.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../../..');
const files = ['frontend/.env.example', 'backend/.env.example', 'backend/supabase/.env.example'];

describe.each(files)('%s', (rel) => {
  const path = join(root, rel);
  it('exists', () => expect(existsSync(path)).toBe(true));
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const vars = [...text.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)].map((m) => ({ name: m[1], value: m[2] }));

  it('has no private value under a public prefix', () => {
    const bad = vars.filter((v) => /^(VITE|NEXT_PUBLIC)_.*(SECRET|PASSWORD|SERVICE_ROLE|PRIVATE|ACCESS_KEY)/.test(v.name));
    expect(bad.map((v) => v.name)).toEqual([]);
  });

  it('contains no hosted or production URLs and no real-looking secrets', () => {
    for (const v of vars) {
      expect(v.value).not.toMatch(/supabase\.co|r2\.dev|r2\.cloudflarestorage|pages\.dev|vercel\.app/);
      expect(v.value).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}|sb_secret_/);
    }
  });

  it('holds only Cloudflare Turnstile TEST keys, never a real site key or secret', () => {
    // Real Turnstile keys start with 0x; Cloudflare's published test keys start with 1x, 2x or 3x.
    for (const v of vars.filter((x) => /TURNSTILE|CAPTCHA/.test(x.name) && x.value !== '')) {
      expect(v.value).toMatch(/^[123]x[0-9A-Za-z]+$/);
    }
    expect(text).not.toMatch(/\b0x4[0-9A-Za-z_-]{15,}/);
  });

  it('points Supabase at the local stack', () => {
    for (const v of vars.filter((x) => /SUPABASE_URL$/.test(x.name))) {
      expect(v.value).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):54321$/);
    }
  });
});

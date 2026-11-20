// Group: config. Tracked .env.example files must be safe to copy and publish.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../../..');
const files = ['frontend/.env.example', 'frontend/.dev.vars.example', 'api/.dev.vars.example', 'backend/.env.example', 'backend/supabase/.env.example'];

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

  it('holds no R2 credentials or bucket settings: media is reached only through the Worker R2 bindings', () => {
    expect(vars.map((v) => v.name).filter((n) => /^(R2_|NEXT_PUBLIC_\w*R2|MEDIA_)/.test(n))).toEqual([]);
  });

  it('points Supabase at the local stack', () => {
    for (const v of vars.filter((x) => /SUPABASE_URL$/.test(x.name))) {
      expect(v.value).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):54321$/);
    }
  });

  it('uses the current key names and none of the deprecated ones', () => {
    expect(text).not.toMatch(/ANON_KEY|SERVICE_ROLE|ADMIN_SECRET_KEY/);
    // placeholders only: any Supabase key value must be empty
    for (const v of vars.filter((x) => /SUPABASE_(PUBLISHABLE|SECRET)_KEY$/.test(x.name))) {
      expect(v.value).toBe('');
    }
  });
});

describe('where each Supabase key may be configured', () => {
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

  it('the browser and Pages Function examples hold the publishable key and never a secret key', () => {
    for (const rel of ['frontend/.env.example', 'frontend/.dev.vars.example']) {
      expect(read(rel), rel).not.toMatch(/SUPABASE_SECRET_KEY|sb_secret_/);
    }
    expect(read('frontend/.env.example')).toMatch(/^VITE_SUPABASE_PUBLISHABLE_KEY=$/m);
    expect(read('frontend/.dev.vars.example')).toMatch(/^SUPABASE_PUBLISHABLE_KEY=$/m);
  });

  it('only the server-side examples (the API Worker and the staging-check template) hold the secret key, without a public prefix', () => {
    for (const rel of ['api/.dev.vars.example', 'backend/.env.example']) {
      const text = read(rel);
      expect(text, rel).toMatch(/^SUPABASE_PUBLISHABLE_KEY=$/m);
      expect(text, rel).toMatch(/^SUPABASE_SECRET_KEY=$/m);
      expect(text, rel).not.toMatch(/^(NEXT_PUBLIC|VITE)_[A-Z_]*SECRET/m);
    }
  });

  it('the API Worker example runs as the local environment and holds no R2 credentials', () => {
    const api = read('api/.dev.vars.example');
    expect(api).toMatch(/^SL_ENVIRONMENT=local$/m);
    expect(api).not.toMatch(/^R2_/m);
  });

  it('the Pages Function example keeps its variables separate from the browser ones', () => {
    expect(read('frontend/.dev.vars.example')).not.toMatch(/^VITE_/m);
    expect(read('frontend/.env.example')).not.toMatch(/^SUPABASE_(URL|PUBLISHABLE_KEY)=/m);
  });
});

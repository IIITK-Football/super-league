// Group: tooling. scripts/env-status.mjs reports, per environment file and variable NAME, whether the variable is set,
// empty or missing. It must never print a value: the whole point is to check configuration without exposing secrets.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
// @ts-ignore plain ESM
import { envStatus, formatStatus, TARGETS } from '../../../scripts/env-status.mjs';

// Built at run time so the source holds no secret-shaped literal (the commit scanner would rightly flag one).
const SECRET = ['sb', 'secret', 'THIS_MUST_NEVER_BE_PRINTED_0123456789'].join('_');
const KEY = ['sb', 'publishable', 'ALSO_NEVER_PRINTED_abcdef'].join('_');
let root: string;
const write = (rel: string, text: string) => {
  const p = join(root, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, text);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'envstatus-'));
});

describe('envStatus', () => {
  it('reports set, empty and missing by name', () => {
    write('backend/.env.local', `SUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_PUBLISHABLE_KEY=${KEY}\nSUPABASE_SECRET_KEY=\n`);
    const r = envStatus(root).find((t: { file: string }) => t.file === 'backend/.env.local');
    const by = Object.fromEntries(r.vars.map((v: { name: string; state: string }) => [v.name, v.state]));
    expect(r.exists).toBe(true);
    expect(by.SUPABASE_URL).toBe('set');
    expect(by.SUPABASE_PUBLISHABLE_KEY).toBe('set');
    expect(by.SUPABASE_SECRET_KEY).toBe('empty');
  });

  it('reports a file that does not exist, with every variable missing', () => {
    const r = envStatus(root).find((t: { file: string }) => t.file === 'frontend/.env.staging.local');
    expect(r.exists).toBe(false);
    expect(r.vars.every((v: { state: string }) => v.state === 'missing')).toBe(true);
  });

  it('understands quotes, export, comments and spaces', () => {
    write('frontend/.env.local', `# comment\nexport VITE_SUPABASE_URL="http://127.0.0.1:54321"\nVITE_API_URL = 'x'\nVITE_TURNSTILE_SITE_KEY=''\n`);
    const r = envStatus(root).find((t: { file: string }) => t.file === 'frontend/.env.local');
    const by = Object.fromEntries(r.vars.map((v: { name: string; state: string }) => [v.name, v.state]));
    expect(by.VITE_SUPABASE_URL).toBe('set');
    expect(by.VITE_API_URL).toBe('set');
    expect(by.VITE_TURNSTILE_SITE_KEY).toBe('empty');
  });

  it('lists the names of other variables a file defines (never their values), to spot a naming mix-up', () => {
    write('backend/.env.staging.local', `STAGING_SUPABASE_URL=https://example.test\nSTAGING_SECRET=${SECRET}\nSUPABASE_URL=x\n`);
    const r = envStatus(root).find((t: { file: string }) => t.file === 'backend/.env.staging.local');
    expect(r.others.sort()).toEqual(['STAGING_SECRET', 'STAGING_SUPABASE_URL']);
    expect(formatStatus(envStatus(root))).toMatch(/other names: .*STAGING_SECRET/);
    expect(formatStatus(envStatus(root))).not.toContain(SECRET);
  });

  it('never returns or prints a value, in the data or in the formatted report', () => {
    write('backend/.env.local', `SUPABASE_SECRET_KEY=${SECRET}\nSUPABASE_PUBLISHABLE_KEY=${KEY}\n`);
    write('backend/.env.staging.local', `SUPABASE_SECRET_KEY=${SECRET}\n`);
    const data = envStatus(root);
    expect(JSON.stringify(data)).not.toContain(SECRET);
    expect(JSON.stringify(data)).not.toContain(KEY);
    const text = formatStatus(data);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(KEY);
    expect(text).toMatch(/SUPABASE_SECRET_KEY/);
  });

  it('covers local and staging targets, and none of them names production or the backup project', () => {
    const files = TARGETS.map((t: { file: string }) => t.file);
    expect(files).toContain('backend/.env.local');
    expect(files).toContain('frontend/.env.local');
    expect(files).toContain('backend/supabase/.env');
    expect(files).toContain('backend/.env.staging.local');
    expect(JSON.stringify(TARGETS)).not.toMatch(/obkxfepdpdufxawhzaen|55322|superLeagueBackup|\.env\.production/i);
  });
});

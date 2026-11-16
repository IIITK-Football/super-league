// Group: auth-identity. The local Auth config keeps the sign-in protections switched on.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const config = readFileSync(join(__dirname, '../../supabase/config.toml'), 'utf8');
const section = (name: string) => {
  const start = config.indexOf(`\n[${name}]`);
  if (start < 0) return '';
  const next = config.indexOf('\n[', start + 1);
  return config.slice(start, next < 0 ? undefined : next);
};

describe('supabase/config.toml auth settings', () => {
  it('requires Turnstile for password endpoints, with the secret read from the environment', () => {
    const captcha = section('auth.captcha');
    expect(captcha).toMatch(/^enabled = true$/m);
    expect(captcha).toMatch(/^provider = "turnstile"$/m);
    expect(captcha).toMatch(/^secret = "env\(SUPABASE_AUTH_CAPTCHA_SECRET\)"$/m);
  });

  it('never contains a literal secret or OAuth credential', () => {
    expect(config).not.toMatch(/^\s*(secret|client_id)\s*=\s*"(?!env\()[^"]+"/m);
  });

  it('requires an emailed code to change the password on an older session', () => {
    expect(section('auth.email')).toMatch(/^secure_password_change = true$/m);
  });

  it('requires verified email and a minimum password length of 8', () => {
    expect(section('auth.email')).toMatch(/^enable_confirmations = true$/m);
    expect(config).toMatch(/^minimum_password_length = 8$/m);
  });

  it('keeps Google sign-in enabled with env-based credentials', () => {
    const google = section('auth.external.google');
    expect(google).toMatch(/^enabled = true$/m);
    expect(google).toMatch(/client_id = "env\(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID\)"/);
    expect(google).toMatch(/secret = "env\(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET\)"/);
  });
});

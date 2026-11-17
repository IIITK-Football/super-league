// Group: config. Keep elevated keys out of the browser bundle: at build time (private-looking VITE_ names fail the
// build, because Vite inlines every VITE_ value) and after it (the built files are scanned for secret-key formats).
import { describe, expect, it } from 'vitest';
import { privateViteVars } from '../env';
import { findElevatedKeys } from '../../../scripts/check-bundle.mjs';

// Built at run time so this file never contains a key-looking literal.
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = (role) => `eyJ${b64url({ alg: 'HS256' }).slice(3)}.${b64url({ role, iss: 'supabase-demo' })}.${'s'.repeat(30)}`;

describe('privateViteVars', () => {
  it('lists VITE_ names that look private and nothing else', () => {
    expect(
      privateViteVars({
        VITE_SUPABASE_URL: 'a',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'b',
        VITE_TURNSTILE_SITE_KEY: 'c',
        VITE_SUPABASE_SECRET_KEY: 'd',
        VITE_SUPABASE_SERVICE_ROLE_KEY: 'e',
        VITE_DEMO_PASSWORD: 'f',
        NOT_PUBLIC_SECRET: 'g',
      }).sort(),
    ).toEqual(['VITE_DEMO_PASSWORD', 'VITE_SUPABASE_SECRET_KEY', 'VITE_SUPABASE_SERVICE_ROLE_KEY']);
  });

  it('allows an empty environment', () => {
    expect(privateViteVars({})).toEqual([]);
  });
});

describe('findElevatedKeys', () => {
  it('finds a new-format secret key without returning its value', () => {
    const hits = findElevatedKeys(`const k="sb_secret_${'A'.repeat(24)}";`);
    expect(hits).toEqual([{ kind: 'secret key (sb_secret_)' }]);
    expect(JSON.stringify(hits)).not.toContain('AAAA');
  });

  it('finds a legacy service_role JWT but not an anon one', () => {
    expect(findElevatedKeys(`x="${fakeJwt('service_role')}"`)).toEqual([{ kind: 'legacy service_role key (JWT)' }]);
    expect(findElevatedKeys(`x="${fakeJwt('anon')}"`)).toEqual([]);
  });

  it('allows a publishable key and ordinary code', () => {
    expect(findElevatedKeys(`const p="sb_publishable_${'B'.repeat(24)}"; var role="service_role_label";`)).toEqual([]);
  });

  it('ignores an unparseable JWT-looking string', () => {
    expect(findElevatedKeys('eyJnotreallyajwt.eyJxxxxxxxxxxxxxxxxxxxxxxxx.yyyyyyyyyyyyyyyyyyyyyyyyy')).toEqual([]);
  });
});

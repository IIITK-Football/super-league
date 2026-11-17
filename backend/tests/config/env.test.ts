// Group: config. Env validation must name missing variables and never print values.
import { describe, expect, it } from 'vitest';
import { EnvError, validateBackendEnv } from '../../lib/env';

const local = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'publishable-placeholder-value',
  SUPABASE_SECRET_KEY: 'secret-placeholder-value',
  NODE_ENV: 'development',
};

describe('validateBackendEnv', () => {
  it('accepts a complete local configuration', () => {
    expect(() => validateBackendEnv(local)).not.toThrow();
  });

  it('names every missing variable', () => {
    try {
      validateBackendEnv({ NODE_ENV: 'development' });
      throw new Error('expected failure');
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      const msg = (e as Error).message;
      for (const n of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']) {
        expect(msg).toContain(n);
      }
    }
  });

  it('does not accept the old key names, and says what they were renamed to (names only)', () => {
    try {
      validateBackendEnv({
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_ANON_KEY: 'old-anon-value',
        SUPABASE_SERVICE_ROLE_KEY: 'old-service-value',
        NODE_ENV: 'development',
      });
      throw new Error('expected failure');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('SUPABASE_PUBLISHABLE_KEY');
      expect(msg).toContain('SUPABASE_SECRET_KEY');
      expect(msg).toMatch(/SUPABASE_ANON_KEY[\s\S]*renamed[\s\S]*SUPABASE_PUBLISHABLE_KEY/);
      expect(msg).toMatch(/SUPABASE_SERVICE_ROLE_KEY[\s\S]*renamed[\s\S]*SUPABASE_SECRET_KEY/);
      expect(msg).not.toContain('old-anon-value');
      expect(msg).not.toContain('old-service-value');
    }
  });

  it('does not mention renames when the new names are present', () => {
    expect(() => validateBackendEnv({ ...local, SUPABASE_ANON_KEY: 'leftover' })).not.toThrow();
  });

  it('never includes values in errors', () => {
    try {
      validateBackendEnv({ ...local, SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co' });
      throw new Error('expected failure');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain('abcdefghijklmnop');
      expect(msg).not.toContain('secret-value');
    }
  });

  it('refuses a non-local Supabase URL in development', () => {
    expect(() =>
      validateBackendEnv({ ...local, SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co' }),
    ).toThrow(/SUPABASE_URL.*local/);
  });

  it('allows a remote URL in development only with explicit opt-in', () => {
    expect(() =>
      validateBackendEnv({
        ...local,
        SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
        ALLOW_REMOTE_SUPABASE: 'true',
      }),
    ).not.toThrow();
  });

  it('allows a remote URL in production', () => {
    expect(() =>
      validateBackendEnv({ ...local, NODE_ENV: 'production', SUPABASE_URL: 'https://x.supabase.co' }),
    ).not.toThrow();
  });

  it('rejects private-looking variables with a public prefix', () => {
    expect(() =>
      validateBackendEnv({ ...local, NEXT_PUBLIC_R2_SECRET_ACCESS_KEY: 'x' }),
    ).toThrow(/NEXT_PUBLIC_R2_SECRET_ACCESS_KEY/);
    expect(() => validateBackendEnv({ ...local, VITE_DEMO_PASSWORD: 'x' })).toThrow(/VITE_DEMO_PASSWORD/);
  });

  it('rejects an elevated Supabase key under any public prefix', () => {
    for (const name of ['NEXT_PUBLIC_SUPABASE_SECRET_KEY', 'VITE_SUPABASE_SECRET_KEY', 'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY']) {
      expect(() => validateBackendEnv({ ...local, [name]: 'x' }), name).toThrow(new RegExp(name));
    }
  });

  it('allows the publishable key under a public prefix (it is meant to be public)', () => {
    expect(() => validateBackendEnv({ ...local, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'x' })).not.toThrow();
  });
});

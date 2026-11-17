// Group: config. Frontend public-env validation.
import { describe, expect, it } from 'vitest';
import { EnvError, readPublicEnv } from '../env';

const local = {
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'publishable-placeholder-value',
  DEV: true,
};

describe('readPublicEnv', () => {
  it('returns the public Supabase settings', () => {
    expect(readPublicEnv(local)).toEqual({
      supabaseUrl: 'http://127.0.0.1:54321',
      supabasePublishableKey: 'publishable-placeholder-value',
    });
  });

  it('names missing variables without falling back to dummy values', () => {
    expect(() => readPublicEnv({ DEV: true })).toThrow(/VITE_SUPABASE_URL[\s\S]*VITE_SUPABASE_PUBLISHABLE_KEY/);
    expect(() => readPublicEnv({ DEV: true })).toThrow(EnvError);
  });

  it('does not read the old anon key name, and says it was renamed (name only)', () => {
    const old = { VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: 'old-anon-value', DEV: true };
    expect(() => readPublicEnv(old)).toThrow(/VITE_SUPABASE_ANON_KEY was renamed to VITE_SUPABASE_PUBLISHABLE_KEY/);
    try {
      readPublicEnv(old);
    } catch (e) {
      expect(e.message).not.toContain('old-anon-value');
    }
  });

  it('is happy with a leftover old name once the new one is set', () => {
    expect(() => readPublicEnv({ ...local, VITE_SUPABASE_ANON_KEY: 'leftover' })).not.toThrow();
  });

  it('refuses a hosted Supabase URL during development unless opted in', () => {
    const remote = { ...local, VITE_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co' };
    expect(() => readPublicEnv(remote)).toThrow(/VITE_SUPABASE_URL.*local/);
    try {
      readPublicEnv(remote);
    } catch (e) {
      expect(e.message).not.toContain('abcdefghijklmnop');
    }
    expect(() => readPublicEnv({ ...remote, VITE_ALLOW_REMOTE_SUPABASE: 'true' })).not.toThrow();
  });

  it('allows a hosted URL in production builds', () => {
    expect(() =>
      readPublicEnv({ ...local, DEV: false, VITE_SUPABASE_URL: 'https://x.supabase.co' }),
    ).not.toThrow();
  });

  it('rejects private-looking VITE_ variables', () => {
    expect(() => readPublicEnv({ ...local, VITE_DEMO_PASSWORD: 'x' })).toThrow(/VITE_DEMO_PASSWORD/);
    expect(() => readPublicEnv({ ...local, VITE_R2_SECRET_ACCESS_KEY: 'x' })).toThrow(/VITE_R2_SECRET_ACCESS_KEY/);
  });

  it('rejects an elevated Supabase key under the VITE_ prefix, whatever it is called', () => {
    for (const name of ['VITE_SUPABASE_SECRET_KEY', 'VITE_SUPABASE_SERVICE_ROLE_KEY', 'VITE_SB_SECRET']) {
      expect(() => readPublicEnv({ ...local, [name]: 'x' }), name).toThrow(new RegExp(name));
    }
  });
});

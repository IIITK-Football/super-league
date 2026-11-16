// Group: config. Frontend public-env validation.
import { describe, expect, it } from 'vitest';
import { EnvError, readPublicEnv } from '../env';

const local = {
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
  VITE_SUPABASE_ANON_KEY: 'anon-public-value',
  DEV: true,
};

describe('readPublicEnv', () => {
  it('returns the public Supabase settings', () => {
    expect(readPublicEnv(local)).toEqual({
      supabaseUrl: 'http://127.0.0.1:54321',
      supabaseAnonKey: 'anon-public-value',
    });
  });

  it('names missing variables without falling back to dummy values', () => {
    expect(() => readPublicEnv({ DEV: true })).toThrow(/VITE_SUPABASE_URL.*VITE_SUPABASE_ANON_KEY/s);
    expect(() => readPublicEnv({ DEV: true })).toThrow(EnvError);
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
});

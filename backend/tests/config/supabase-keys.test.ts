// Group: config. Server key getters fail closed, name the missing variable, and never fall back
// to a weaker or stronger key.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnvError } from '../../lib/env';
import { publishableKey, secretKey, supabaseUrl } from '../../lib/supabase/keys';

const saved = { ...process.env };
beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});
afterEach(() => {
  process.env = { ...saved };
});

describe('supabase key getters', () => {
  it('return the configured values', () => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'pub-value';
    process.env.SUPABASE_SECRET_KEY = 'sec-value';
    expect(supabaseUrl()).toBe('http://127.0.0.1:54321');
    expect(publishableKey()).toBe('pub-value');
    expect(secretKey()).toBe('sec-value');
  });

  it('throw an EnvError that names the variable and not any value', () => {
    for (const [fn, name] of [
      [supabaseUrl, 'SUPABASE_URL'],
      [publishableKey, 'SUPABASE_PUBLISHABLE_KEY'],
      [secretKey, 'SUPABASE_SECRET_KEY'],
    ] as const) {
      expect(fn).toThrow(EnvError);
      expect(fn).toThrow(name);
    }
  });

  it('never fall back between the two keys', () => {
    process.env.SUPABASE_PUBLISHABLE_KEY = 'pub-value';
    expect(secretKey).toThrow(/SUPABASE_SECRET_KEY/); // a missing secret must not become the publishable key
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    process.env.SUPABASE_SECRET_KEY = 'sec-value';
    expect(publishableKey).toThrow(/SUPABASE_PUBLISHABLE_KEY/);
  });

  it('do not read the old variable names', () => {
    process.env.SUPABASE_ANON_KEY = 'old-anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'old-service';
    expect(publishableKey).toThrow();
    expect(secretKey).toThrow();
  });

  it('treat an empty value as missing', () => {
    process.env.SUPABASE_SECRET_KEY = '';
    expect(secretKey).toThrow(/SUPABASE_SECRET_KEY/);
  });
});

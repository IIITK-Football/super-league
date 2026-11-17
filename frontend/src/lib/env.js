// Public (browser) configuration validation (SL-012). Errors name variables, never values.
export class EnvError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EnvError';
  }
}

const PRIVATE_NAME = /(SECRET|PASSWORD|SERVICE_ROLE|PRIVATE|ACCESS_KEY)/;

// VITE_ names that look private. Vite inlines every VITE_ value into the browser bundle, so
// vite.config.js uses this to fail the build, and the app checks again at startup.
export function privateViteVars(env) {
  return Object.keys(env).filter((n) => n.startsWith('VITE_') && PRIVATE_NAME.test(n));
}

function isLocalUrl(value) {
  try {
    const host = new URL(value).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

export function readPublicEnv(env = import.meta.env) {
  const problems = [];
  const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'].filter((n) => !env[n]);
  if (missing.length) problems.push(`Missing environment variables: ${missing.join(', ')}`);
  // Supabase replaced the legacy anon key with the publishable key. Say what was renamed (name only).
  if (env.VITE_SUPABASE_ANON_KEY && !env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    problems.push('VITE_SUPABASE_ANON_KEY was renamed to VITE_SUPABASE_PUBLISHABLE_KEY: set the new variable with the publishable key (the old name is no longer read).');
  }

  const leaked = privateViteVars(env);
  if (leaked.length) {
    problems.push(`Private values must not use the VITE_ prefix (they ship to the browser): ${leaked.join(', ')}`);
  }

  if (
    env.DEV &&
    env.VITE_SUPABASE_URL &&
    !isLocalUrl(env.VITE_SUPABASE_URL) &&
    env.VITE_ALLOW_REMOTE_SUPABASE !== 'true'
  ) {
    problems.push(
      'VITE_SUPABASE_URL is not a local address. Development must use the local Supabase stack ' +
        '(http://127.0.0.1:54321); set VITE_ALLOW_REMOTE_SUPABASE=true only with explicit approval.',
    );
  }

  if (problems.length) throw new EnvError(problems.join('\n'));
  return { supabaseUrl: env.VITE_SUPABASE_URL, supabasePublishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY };
}

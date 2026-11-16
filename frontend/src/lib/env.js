// Public (browser) configuration validation (SL-012). Errors name variables, never values.
export class EnvError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EnvError';
  }
}

const PRIVATE_NAME = /(SECRET|PASSWORD|SERVICE_ROLE|PRIVATE|ACCESS_KEY)/;

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
  const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].filter((n) => !env[n]);
  if (missing.length) problems.push(`Missing environment variables: ${missing.join(', ')}`);

  const leaked = Object.keys(env).filter((n) => n.startsWith('VITE_') && PRIVATE_NAME.test(n));
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
  return { supabaseUrl: env.VITE_SUPABASE_URL, supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY };
}

/**
 * Startup configuration validation (SL-012).
 * Errors name variables but never include their values.
 */
export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

type Env = Record<string, string | undefined>;

const REQUIRED = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY'] as const;
// Supabase replaced the legacy `anon` and `service_role` keys with publishable and secret keys.
// If an old name is still set, say what it was renamed to (names only, never values).
const RENAMED: Record<string, string> = {
  SUPABASE_ANON_KEY: 'SUPABASE_PUBLISHABLE_KEY',
  SUPABASE_SERVICE_ROLE_KEY: 'SUPABASE_SECRET_KEY',
};
const PRIVATE_NAME = /(SECRET|PASSWORD|SERVICE_ROLE|PRIVATE|ACCESS_KEY)/;
const PUBLIC_PREFIX = /^(VITE|NEXT_PUBLIC)_/;

export function isLocalUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

export function validateBackendEnv(env: Env = process.env): void {
  const problems: string[] = [];

  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length) problems.push(`Missing required environment variables: ${missing.join(', ')}`);
  for (const [oldName, newName] of Object.entries(RENAMED)) {
    if (env[oldName] && !env[newName]) {
      problems.push(`${oldName} was renamed to ${newName}: set ${newName} with the new key (the old name is no longer read).`);
    }
  }

  const publicSecrets = Object.keys(env).filter((n) => PUBLIC_PREFIX.test(n) && PRIVATE_NAME.test(n));
  if (publicSecrets.length) {
    problems.push(
      `Private values must not use a public prefix (VITE_/NEXT_PUBLIC_): ${publicSecrets.join(', ')}`,
    );
  }

  if (
    env.NODE_ENV === 'development' &&
    env.SUPABASE_URL &&
    !isLocalUrl(env.SUPABASE_URL) &&
    env.ALLOW_REMOTE_SUPABASE !== 'true'
  ) {
    problems.push(
      'SUPABASE_URL is not a local address. Development must use the local Supabase stack ' +
        '(http://127.0.0.1:54321); set ALLOW_REMOTE_SUPABASE=true only with explicit approval.',
    );
  }

  if (problems.length) throw new EnvError(problems.join('\n'));
}

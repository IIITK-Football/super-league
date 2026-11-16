import { validateBackendEnv } from './lib/env';

// Runs once when the Next.js server starts; fails fast naming bad variables.
export function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') validateBackendEnv();
}

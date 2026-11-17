import { EnvError } from '../env';

// Server-side Supabase configuration, read lazily so a missing value fails with a clear message
// naming the variable (never its value) at the point of use.
//
// - SUPABASE_PUBLISHABLE_KEY is the low-privilege key (RLS applies). It is the key the browser
//   uses too; on the server it builds per-request clients that act as the signed-in user.
// - SUPABASE_SECRET_KEY bypasses RLS. Server only, and only for code that genuinely needs
//   elevated access (cron/sync jobs, grading, role-checked admin writes).
// There is deliberately NO fallback between the two: a missing secret must never silently
// become the weaker key, and the secret must never be used where a publishable key will do.
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new EnvError(`Missing required environment variable: ${name}`);
  return value;
}

export const supabaseUrl = (): string => required('SUPABASE_URL');
export const publishableKey = (): string => required('SUPABASE_PUBLISHABLE_KEY');
export const secretKey = (): string => required('SUPABASE_SECRET_KEY');

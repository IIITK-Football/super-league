// Access helpers for roster routes that must run on the server (portrait uploads). Every query runs as the caller
// (publishable key + the caller's token), so row level security decides each read.
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { publishableKey } from '@/lib/supabase/keys';
import { noCookies } from '@/lib/http';

export async function callerClient(request: Request): Promise<SupabaseClient> {
  const cookieStore = noCookies;
  const authHeader = request.headers.get('Authorization');
  return createServerClient(process.env.SUPABASE_URL!, publishableKey(), {
    cookies: { getAll: () => cookieStore.getAll(), setAll() {} },
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
  }) as unknown as SupabaseClient;
}

export const jsonError = (message: string, status: number) => Response.json({ success: false, message }, { status });

type Caller = { supabase: SupabaseClient; user: User };

// The caller must be signed in (role and assignment are checked by the caller of this helper).
export async function requireUser(request: Request): Promise<Caller | Response> {
  const supabase = await callerClient(request);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return jsonError('Please sign in again.', 401);
  return { supabase, user: data.user };
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isResponse = (value: unknown): value is Response => value instanceof Response;

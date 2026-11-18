// Access helpers for the roster routes. Every query runs as the caller (publishable key + the caller's token), so
// row level security decides each read and write; the explicit checks only turn a refusal into a clear response.
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { publishableKey } from '@/lib/supabase/keys';

export async function callerClient(request: Request): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const authHeader = request.headers.get('Authorization');
  return createServerClient(process.env.SUPABASE_URL!, publishableKey(), {
    cookies: { getAll: () => cookieStore.getAll(), setAll() {} },
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
  }) as unknown as SupabaseClient;
}

export const jsonError = (message: string, status: number) => NextResponse.json({ success: false, message }, { status });

type Caller = { supabase: SupabaseClient; user: User };

// The caller must be signed in and hold the dictator role (no other role implies it, legacy "admin" included).
export async function requireDictator(request: Request): Promise<Caller | NextResponse> {
  const supabase = await callerClient(request);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return jsonError('Please sign in again.', 401);
  const { data: isDictator, error: roleError } = await supabase.rpc('is_dictator');
  if (roleError) throw roleError;
  if (isDictator !== true) return jsonError('Only a dictator can manage players and rosters.', 403);
  return { supabase, user: data.user };
}

// The caller must be signed in (role and assignment are checked by the caller of this helper).
export async function requireUser(request: Request): Promise<Caller | NextResponse> {
  const supabase = await callerClient(request);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return jsonError('Please sign in again.', 401);
  return { supabase, user: data.user };
}

// Maps a database refusal to a response a person can act on; anything else is rethrown.
export function dbErrorResponse(error: { code?: string; message?: string; details?: string } | null): NextResponse | null {
  if (!error) return null;
  const text = `${error.message ?? ''} ${error.details ?? ''}`;
  switch (error.code) {
    case '23505':
      if (/player_season/.test(text)) return jsonError('This player is already on a team this season.', 409);
      if (/jersey/.test(text)) return jsonError('That jersey number is already taken on this team.', 409);
      return jsonError('That record already exists.', 409);
    case '23503':
      return jsonError('This record is still referenced by match history or a roster, so it is kept.', 409);
    case '23514':
      return jsonError('A value is outside its allowed range.', 400);
    case '22023':
    case '22P02':
      return jsonError(error.message || 'A value is invalid.', 400);
    case '42501':
      return jsonError('Only a dictator can manage players and rosters.', 403);
    case 'P0002':
      return jsonError(error.message || 'Not found.', 404);
    default:
      return null;
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isResponse = (value: unknown): value is NextResponse => value instanceof NextResponse;

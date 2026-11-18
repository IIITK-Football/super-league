import type { SupabaseClient } from '@supabase/supabase-js';

// Resolves which division and season a request is about. Divisions are data: a request names one by slug
// (?division=super-league) and optionally a season by slug or id (?season=2027); without a season the division's
// current season is used. Reads go through the caller's client, so row level security hides hidden or archived
// divisions and seasons from the public.

export const DEFAULT_DIVISION = 'super-league';
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Scope = {
  division: { id: string; slug: string; name: string };
  season: { id: string; slug: string; name: string; is_current: boolean; format: string };
};

export class ScopeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function resolveScope(
  supabase: SupabaseClient,
  params: { division?: string | null; season?: string | null },
): Promise<Scope> {
  const divisionSlug = (params.division || DEFAULT_DIVISION).trim();
  if (!SLUG.test(divisionSlug)) throw new ScopeError(400, 'division must be a division slug, for example super-league');
  const seasonKey = params.season?.trim() || null;
  if (seasonKey && !SLUG.test(seasonKey) && !UUID.test(seasonKey)) throw new ScopeError(400, 'season must be a season slug or id');

  const { data: division, error: divisionError } = await supabase
    .from('divisions').select('id, slug, name').eq('slug', divisionSlug).maybeSingle();
  if (divisionError) throw divisionError;
  if (!division) throw new ScopeError(404, `Division "${divisionSlug}" not found`);

  let query = supabase.from('seasons').select('id, slug, name, is_current, format').eq('division_id', division.id);
  if (!seasonKey) query = query.eq('is_current', true);
  else if (UUID.test(seasonKey)) query = query.eq('id', seasonKey);
  else query = query.eq('slug', seasonKey);
  const { data: season, error: seasonError } = await query.maybeSingle();
  if (seasonError) throw seasonError;
  if (!season) {
    throw new ScopeError(404, seasonKey ? `Season "${seasonKey}" not found in ${division.name}` : `${division.name} has no current season`);
  }
  return { division, season };
}

export function scopeFromUrl(supabase: SupabaseClient, request: Request): Promise<Scope> {
  const { searchParams } = new URL(request.url);
  return resolveScope(supabase, { division: searchParams.get('division'), season: searchParams.get('season') });
}

// Team ids entered in a season.
export async function seasonTeamIds(supabase: SupabaseClient, seasonId: string): Promise<string[]> {
  const { data, error } = await supabase.from('team_entries').select('team_id').eq('season_id', seasonId);
  if (error) throw error;
  return (data ?? []).map((e) => e.team_id as string);
}

export const scopeErrorResponse = (error: unknown) =>
  error instanceof ScopeError ? { status: error.status, body: { success: false, message: error.message } } : null;

import { NextResponse } from 'next/server';
import { publishableKey } from '@/lib/supabase/keys';
import { createClient } from '@supabase/supabase-js';
import { handleError } from '../../../lib/errorHandler';
import { resolveScope, seasonTeamIds } from '@/lib/scope';

export const revalidate = 0; 

const supabase = createClient(
  process.env.SUPABASE_URL!,
  publishableKey()
);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const all = searchParams.get('all');

    let query = supabase
      .from('teams')
      .select('id, name, logo_url, team_color')
      .order('name', { ascending: true });

    if (!all) {
      // The teams entered in ?division=<slug>&season=<slug or id> (default: the current season).
      const scope = await resolveScope(supabase, { division: searchParams.get('division'), season: searchParams.get('season') });
      query = query.in('id', await seasonTeamIds(supabase, scope.season.id));
    }

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return handleError(error, 'Fetch Teams');
  }
}
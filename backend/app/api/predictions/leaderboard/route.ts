export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { publishableKey } from '@/lib/supabase/keys';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { handleError } from '../../../../lib/errorHandler';
import { resolveScope } from '@/lib/scope';

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    
    const supabase = createServerClient(
      process.env.SUPABASE_URL!,
      publishableKey(),
      {
        cookies: { getAll() { return cookieStore.getAll() }, setAll() {} },
      }
    );

    // The division whose flair is shown (?division=<slug>; default Super League).
    const { searchParams } = new URL(request.url);
    const scope = await resolveScope(supabase, { division: searchParams.get('division'), season: searchParams.get('season') });

    // 1. Fetch the top 100 users
    const { data: profiles, error } = await supabase
      .from('user_profiles')
      .select('id, nickname, real_name, email, points')
      .gt('points', 0)
      .order('points', { ascending: false })
      .limit(100);

    if (error) throw error;

    // 2. Each user's flair for this division
    const ids = profiles.map((p) => p.id);
    const { data: flairs, error: flairsError } = ids.length
      ? await supabase.from('division_flairs').select('user_id, team_name').eq('division_id', scope.division.id).in('user_id', ids)
      : { data: [] as { user_id: string; team_name: string }[], error: null };
    if (flairsError) throw flairsError;
    const flairByUser = new Map((flairs ?? []).map((f) => [f.user_id, f.team_name]));

    const overall = profiles.map(p => ({
      user_id: p.id,
      username: p.nickname || p.real_name || p.email?.split('@')[0] || `Fan_${p.id.substring(0, 5)}`,
      total_points: p.points || 0,
      flair: flairByUser.get(p.id) || null
    }));

    return NextResponse.json({
      success: true,
      data: {
        overall: overall,
        top_scorers_predictor: [],
        top_assists_predictor: []
      }
    });

  } catch (error) {
    console.error("Leaderboard Fetch Error:", error);
    return handleError(error, "Fetch Leaderboards");
  }
}
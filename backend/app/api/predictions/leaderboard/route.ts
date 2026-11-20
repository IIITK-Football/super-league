export const dynamic = 'force-dynamic';

import { publishableKey } from '@/lib/supabase/keys';
import { createServerClient } from '@supabase/ssr';
import { handleError } from '../../../../lib/errorHandler';
import { resolveScope } from '@/lib/scope';
import { noCookies } from '@/lib/http';

export async function GET(request: Request) {
  try {
    const cookieStore = noCookies;
    
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

    // 1. The season's top 100 users by fantasy points (graded predictions on this season's matches)
    const { data: ranked, error } = await supabase.rpc('season_fantasy_leaderboard', { p_season: scope.season.id, p_limit: 100 });
    if (error) throw error;
    const pointsByUser = new Map((ranked ?? []).map((r: any) => [r.user_id, r.points]));
    const rankedIds = (ranked ?? []).map((r: any) => r.user_id);
    const { data: profileRows, error: profilesError } = rankedIds.length
      ? await supabase.from('user_profiles').select('id, nickname, real_name, email').in('id', rankedIds)
      : { data: [] as any[], error: null };
    if (profilesError) throw profilesError;
    const profileById = new Map((profileRows ?? []).map((p: any) => [p.id, p]));
    const profiles = rankedIds.map((id: string) => ({ ...(profileById.get(id) ?? { id }), id, points: pointsByUser.get(id) ?? 0 }));

    // 2. Each user's flair for this division
    const ids = profiles.map((p: any) => p.id as string);
    const { data: flairs, error: flairsError } = ids.length
      ? await supabase.from('division_flairs').select('user_id, team_name').eq('division_id', scope.division.id).in('user_id', ids)
      : { data: [] as { user_id: string; team_name: string }[], error: null };
    if (flairsError) throw flairsError;
    const flairByUser = new Map((flairs ?? []).map((f) => [f.user_id, f.team_name]));

    const overall = profiles.map((p: any) => ({
      user_id: p.id,
      username: p.nickname || p.real_name || p.email?.split('@')[0] || `Fan_${p.id.substring(0, 5)}`,
      total_points: p.points || 0,
      flair: flairByUser.get(p.id) || null
    }));

    return Response.json({
      success: true,
      data: {
        scope: { division: scope.division, season: scope.season },
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
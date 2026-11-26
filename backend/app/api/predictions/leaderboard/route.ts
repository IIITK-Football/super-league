import { requestClient } from '@/lib/supabase/clients';
export const dynamic = 'force-dynamic';

import { handleError } from '../../../../lib/errorHandler';
import { resolveScope } from '@/lib/scope';

export async function GET(request: Request) {
  try {
    const supabase = requestClient(request);

    // The division whose flair is shown (?division=<slug>; default Super League).
    const { searchParams } = new URL(request.url);
    const scope = await resolveScope(supabase, { division: searchParams.get('division'), season: searchParams.get('season') }, { section: 'fantasy' });

    // 1. The season's top 100 users by fantasy points (graded predictions on this season's matches)
    const { data: ranked, error } = await supabase.rpc('season_fantasy_leaderboard', { p_season: scope.season.id, p_limit: 100 });
    if (error) throw error;
    const pointsByUser = new Map((ranked ?? []).map((r: any) => [r.user_id, r.points]));
    const rankedIds = (ranked ?? []).map((r: any) => r.user_id);
    // The leaders' profiles and their flair for this division, read together (D-04: at most three rounds).
    const [{ data: profileRows, error: profilesError }, { data: flairs, error: flairsError }] = rankedIds.length
      ? await Promise.all([
          supabase.from('user_profiles').select('id, nickname, real_name').in('id', rankedIds),
          supabase.from('division_flairs').select('user_id, team_name').eq('division_id', scope.division.id).in('user_id', rankedIds),
        ])
      : [{ data: [] as any[], error: null }, { data: [] as { user_id: string; team_name: string }[], error: null }];
    if (profilesError) throw profilesError;
    if (flairsError) throw flairsError;
    const profileById = new Map((profileRows ?? []).map((p: any) => [p.id, p]));
    const profiles = rankedIds.map((id: string) => ({ ...(profileById.get(id) ?? { id }), id, points: pointsByUser.get(id) ?? 0 }));
    const flairByUser = new Map((flairs ?? []).map((f) => [f.user_id, f.team_name]));

    const overall = profiles.map((p: any) => ({
      user_id: p.id,
      username: p.nickname || p.real_name || `Fan_${p.id.substring(0, 5)}`, // never derived from an email
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
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { publishableKey } from '@/lib/supabase/keys';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { handleError } from '../../../../lib/errorHandler';
import { resolveScope } from '@/lib/scope';

async function getSupabaseClient(request: Request) {
  const cookieStore = await cookies();
  const authHeader = request.headers.get('Authorization');

  return createServerClient(process.env.SUPABASE_URL!, publishableKey(), {
    cookies: { getAll() { return cookieStore.getAll() }, setAll() {} },
    global: {
      headers: { Authorization: authHeader || '' },
    },
  });
}

// Mirror of the grading logic — builds a frequency map for player-based scoring
function getFrequencyMap(arr: string[] | null): Record<string, number> {
  const map: Record<string, number> = {};
  for (const item of (arr || [])) {
    map[item] = (map[item] || 0) + 1;
  }
  return map;
}

function computeBreakdown(prediction: any, match: any) {
  const breakdown: { label: string; points: number; detail: string }[] = [];

  const predHome = prediction.predicted_home_score;
  const predAway = prediction.predicted_away_score;
  const actHome = match.home_score;
  const actAway = match.away_score;

  // Stage A: Scoreline
  if (predHome === actHome && predAway === actAway) {
    breakdown.push({
      label: 'Exact Score',
      points: 300,
      detail: `You predicted ${predHome}-${predAway} and it was ${actHome}-${actAway}`
    });
  } else {
    const predDiff = predHome - predAway;
    const actDiff = actHome - actAway;

    const correctResult =
      (predDiff > 0 && actDiff > 0) ||
      (predDiff < 0 && actDiff < 0) ||
      (predDiff === 0 && actDiff === 0);

    if (correctResult) {
      breakdown.push({
        label: 'Correct Result',
        points: 100,
        detail: predDiff > 0 ? 'Home win predicted correctly' : predDiff < 0 ? 'Away win predicted correctly' : 'Draw predicted correctly'
      });
    } else {
      breakdown.push({
        label: 'Wrong Result',
        points: 0,
        detail: `Predicted ${predHome}-${predAway} but result was ${actHome}-${actAway}`
      });
    }

    const goalError = Math.abs(predHome - actHome) + Math.abs(predAway - actAway);
    if (goalError > 0) {
      const penalty = goalError * 10;
      breakdown.push({
        label: 'Goal Difference Penalty',
        points: -penalty,
        detail: `Off by ${goalError} goal${goalError > 1 ? 's' : ''} total (${predHome}-${predAway} vs ${actHome}-${actAway})`
      });
    }
  }

  // Stage B: Scorers
  const predScorers = prediction.predicted_scorers || [];
  const actScorers = match.scorers || [];
  const predScorerMap = getFrequencyMap(predScorers);
  const actScorerMap = getFrequencyMap(actScorers);

  let scorerHits = 0;
  for (const [playerId, predictedCount] of Object.entries(predScorerMap)) {
    if (actScorerMap[playerId]) {
      scorerHits += Math.min(predictedCount as number, actScorerMap[playerId]);
    }
  }

  if (predScorers.length > 0) {
    if (scorerHits > 0) {
      breakdown.push({
        label: 'Correct Scorer' + (scorerHits > 1 ? 's' : ''),
        points: scorerHits * 100,
        detail: `${scorerHits} of ${predScorers.length} scorer prediction${scorerHits > 1 ? 's' : ''} matched`
      });
    }
    const missedScorers = predScorers.length - scorerHits;
    if (missedScorers > 0) {
      breakdown.push({
        label: 'Missed Scorer' + (missedScorers > 1 ? 's' : ''),
        points: 0,
        detail: `${missedScorers} scorer prediction${missedScorers > 1 ? 's' : ''} didn't match`
      });
    }
  }

  // Stage C: Assists
  const predAssists = prediction.predicted_assists || [];
  const actAssists = match.assists || [];
  const predAssistMap = getFrequencyMap(predAssists);
  const actAssistMap = getFrequencyMap(actAssists);

  let assistHits = 0;
  for (const [playerId, predictedCount] of Object.entries(predAssistMap)) {
    if (actAssistMap[playerId]) {
      assistHits += Math.min(predictedCount as number, actAssistMap[playerId]);
    }
  }

  if (predAssists.length > 0) {
    if (assistHits > 0) {
      breakdown.push({
        label: 'Correct Assist' + (assistHits > 1 ? 's' : ''),
        points: assistHits * 50,
        detail: `${assistHits} of ${predAssists.length} assist prediction${assistHits > 1 ? 's' : ''} matched`
      });
    }
    const missedAssists = predAssists.length - assistHits;
    if (missedAssists > 0) {
      breakdown.push({
        label: 'Missed Assist' + (missedAssists > 1 ? 's' : ''),
        points: 0,
        detail: `${missedAssists} assist prediction${missedAssists > 1 ? 's' : ''} didn't match`
      });
    }
  }

  return breakdown;
}

export async function GET(request: Request) {
  try {
    const supabase = await getSupabaseClient(request);

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw { status: 401, message: "Unauthorized" };

    // This user's predictions in the selected season (?division=<slug>&season=<slug or id>; default current)
    const { searchParams } = new URL(request.url);
    const scope = await resolveScope(supabase, { division: searchParams.get('division'), season: searchParams.get('season') });

    // Fetch all predictions for this user, joined with match data + team names via FK join
    const { data: predictions, error } = await supabase
      .from('predictions')
      .select(`
        id,
        match_id,
        predicted_home_score,
        predicted_away_score,
        predicted_scorers,
        predicted_assists,
        points_awarded,
        status,
        created_at,
        matches!inner (
          id,
          season_id,
          home_team_id,
          away_team_id,
          home_score,
          away_score,
          date,
          status,
          scorers,
          assists,
          home:teams!home_team_id(id, name),
          away:teams!away_team_id(id, name)
        )
      `)
      .eq('user_id', user.id)
      .eq('matches.season_id', scope.season.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Flatten team names and compute breakdown
    const enriched = (predictions || []).map((pred: any) => {
      const rawMatch = Array.isArray(pred.matches) ? pred.matches[0] : pred.matches;
      if (!rawMatch) return { ...pred, matches: null, breakdown: null };

      const homeData = Array.isArray(rawMatch.home) ? rawMatch.home[0] : rawMatch.home;
      const awayData = Array.isArray(rawMatch.away) ? rawMatch.away[0] : rawMatch.away;

      const match = {
        ...rawMatch,
        home_team_name: homeData?.name || 'Unknown',
        away_team_name: awayData?.name || 'Unknown',
      };

      return {
        ...pred,
        matches: match,
        breakdown: pred.status === 'graded' ? computeBreakdown(pred, match) : null
      };
    });

    return NextResponse.json({
      success: true,
      data: enriched
    });

  } catch (error) {
    return handleError(error, "Fetch Prediction History");
  }
}

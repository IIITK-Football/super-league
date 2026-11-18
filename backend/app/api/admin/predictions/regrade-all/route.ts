import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { handleError } from '../../../../../lib/errorHandler';

// 1. Authenticate the Admin User (Standard SSR Client)
async function getSupabaseClient(request: Request) {
  try {
    const cookieStore = await cookies();
    const authHeader = request.headers.get('Authorization'); 

    return createServerClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_PUBLISHABLE_KEY as string, {
      cookies: { getAll() { return cookieStore.getAll() }, setAll() {} },
      global: {
        headers: { Authorization: authHeader || '' },
      },
    });
  } catch (err) {
    return createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_PUBLISHABLE_KEY as string);
  }
}

// --- THE FREQUENCY ALGORITHM (Same as regular grading) ---
function getFrequencyMap(arr: string[] | null) {
  const map: Record<string, number> = {};
  for (const item of (arr || [])) {
    map[item] = (map[item] || 0) + 1;
  }
  return map;
}

function calculatePlayerPoints(predicted: string[] | null, actual: string[] | null, pointsPerMatch: number) {
  if (!predicted || !Array.isArray(predicted)) return 0;
  const predMap = getFrequencyMap(predicted);
  const actMap = getFrequencyMap(actual || []);
  let points = 0;

  for (const [playerId, predictedCount] of Object.entries(predMap)) {
    if (actMap[playerId]) {
      const hits = Math.min(predictedCount as number, actMap[playerId]);
      points += hits * pointsPerMatch;
    }
  }
  return points;
}

export async function POST(request: Request) {
  try {
    console.log(`\n--- STARTING GLOBAL RE-GRADING RUN ---`);
    console.log("Checking environment variables...");
    if (!process.env.SUPABASE_SECRET_KEY) {
      console.error("❌ CRITICAL ERROR: SUPABASE_SECRET_KEY is missing from environment variables!");
      return NextResponse.json({ success: false, message: "Server configuration error: SUPABASE_SECRET_KEY is missing." }, { status: 500 });
    }
    const supabase = await getSupabaseClient(request);

    // Security Check: Ensure the user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw { status: 401, message: "Unauthorized" };

    // God Mode client (ignores all cookies/headers)
    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL as string, 
      process.env.SUPABASE_SECRET_KEY as string, 
      {
        auth: { autoRefreshToken: false, persistSession: false }
      }
    );

    // 2. Fetch all completed matches
    const { data: matches, error: matchesError } = await supabaseAdmin
      .from('matches')
      .select('id, home_score, away_score, scorers, assists, status')
      .eq('status', 'completed');

    if (matchesError) throw matchesError;
    if (!matches || matches.length === 0) {
      return NextResponse.json({ success: true, message: "No completed matches found to regrade." });
    }

    console.log(`Found ${matches.length} completed matches. Processing predictions...`);

    // --- 3. THE RE-GRADING LOOP ---
    for (const match of matches) {
      const { data: predictions, error: predError } = await supabaseAdmin
        .from('predictions')
        .select('*')
        .eq('match_id', match.id)
        .eq('status', 'graded');

      if (predError) {
        console.error(`❌ [ERROR] Failed to fetch predictions for match ${match.id}:`, predError.message);
        continue;
      }

      if (!predictions || predictions.length === 0) continue;

      console.log(`- Regrading ${predictions.length} predictions for match ${match.id}...`);

      const gradePromises = predictions.map(async (prediction) => {
        let totalPoints = 0;

        const predHome = prediction.predicted_home_score;
        const predAway = prediction.predicted_away_score;
        const actHome = match.home_score;
        const actAway = match.away_score;

        // Stage A: Scoreline Logic (NEW RULES)
        if (predHome === actHome && predAway === actAway) {
          totalPoints += 300; 
        } else {
          const predDiff = predHome - predAway;
          const actDiff = actHome - actAway;
          
          if (
            (predDiff > 0 && actDiff > 0) || 
            (predDiff < 0 && actDiff < 0) || 
            (predDiff === 0 && actDiff === 0) 
          ) {
            totalPoints += 100; // Correct result (win/loss/draw)
          }

          // Always subtract penalty if not an exact match
          const goalError = Math.abs(predHome - actHome) + Math.abs(predAway - actAway);
          if (goalError > 0) {
            const penalty = goalError * 10;
            totalPoints -= penalty; 
          }
        }

        // Stage B: Player Actions Logic
        totalPoints += calculatePlayerPoints(prediction.predicted_scorers, match.scorers || [], 100); 
        totalPoints += calculatePlayerPoints(prediction.predicted_assists, match.assists || [], 50); 

        // Update the prediction
        const { error: updateErr } = await supabaseAdmin
          .from('predictions')
          .update({ points_awarded: totalPoints, status: 'graded' })
          .eq('id', prediction.id);
          
        if (updateErr) {
          console.error(`❌ [ERROR] Failed to update prediction ${prediction.id}:`, updateErr.message);
        }
      });

      await Promise.all(gradePromises);
      console.log(`✅ [DONE] Match ${match.id} regraded.`);
    }

    // Season fantasy points are the sums of points_awarded (season_fantasy_points), so there is no total to sync.

    return NextResponse.json({ 
      success: true, 
      message: `Successfully regraded matches; season leaderboards follow the new points.` 
    });

  } catch (error: any) {
    console.error("FATAL REGRADING ERROR:", error);
    return NextResponse.json({ 
      success: false, 
      message: error.message || (typeof error === 'string' ? error : "Unknown internal error"),
      detail: JSON.stringify(error)
    }, { status: 500 });
  }
}

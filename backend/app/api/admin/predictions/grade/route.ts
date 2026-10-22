import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js'; // MAGIC FIX 1: Import the pure client
import { cookies } from 'next/headers';
import { handleError } from '../../../../../lib/errorHandler';

// 1. Authenticate the Admin User (Standard SSR Client)
async function getSupabaseClient(request: Request) {
  try {
    const cookieStore = await cookies();
    const authHeader = request.headers.get('Authorization'); 

    return createServerClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_ANON_KEY as string, {
      cookies: { getAll() { return cookieStore.getAll() }, setAll() {} },
      global: {
        headers: { Authorization: authHeader || '' },
      },
    });
  } catch (err) {
    // Fallback for environments where cookies() might throw or fail
    return createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_ANON_KEY as string);
  }
}

// --- THE FREQUENCY ALGORITHM ---
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
      // Use the lower of the two counts to avoid awarding points for "extra" predictions
      const hits = Math.min(predictedCount as number, actMap[playerId]);
      points += hits * pointsPerMatch;
    }
  }
  return points;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.match_id) throw { status: 400, message: "match_id is required for grading." };

    console.log(`\n--- STARTING GRADING RUN FOR MATCH: ${body.match_id} ---`);
    console.log("Service Role Key Present:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error("❌ CRITICAL ERROR: SUPABASE_SERVICE_ROLE_KEY is missing from environment variables!");
      return NextResponse.json({ success: false, message: "Server configuration error: SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
    }

    const supabase = await getSupabaseClient(request);

    // Security Check: Ensure the user clicking the button is an admin
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw { status: 401, message: "Unauthorized" };

    // 2. MAGIC FIX 2: Create a totally isolated God Mode client (ignores all cookies/headers)
    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL as string, 
      process.env.SUPABASE_SERVICE_ROLE_KEY as string, 
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    const { data: roleRecord } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!['admin', 'dictator'].includes(roleRecord?.role)) throw { status: 403, message: "Forbidden" };

    const { data: match, error: matchError } = await supabaseAdmin
      .from('matches')
      .select('home_score, away_score, scorers, assists, status')
      .eq('id', body.match_id)
      .single();

    if (matchError || !match) throw { status: 404, message: "Match not found." };
    if (match.status !== 'completed') throw { status: 400, message: "Match must be marked 'completed' before grading." };

    const { data: predictions, error: predError } = await supabaseAdmin
      .from('predictions')
      .select('*')
      .eq('match_id', body.match_id);

    if (predError) throw predError;
    if (!predictions || predictions.length === 0) {
      console.log("No predictions found. Marking match as graded anyway.");
      const { error: matchUpdateErr } = await supabaseAdmin.from('matches').update({ is_graded: true }).eq('id', body.match_id);
      if (matchUpdateErr) console.warn("Match update warning:", matchUpdateErr.message);
      
      return NextResponse.json({ success: true, message: "No predictions found for this match." });
    }

    console.log(`Found ${predictions.length} predictions. Calculating points...`);

    // --- 4. THE GRADING LOOP ---
    const gradePromises = predictions.map(async (prediction) => {
      let totalPoints = 0;

      const predHome = prediction.predicted_home_score;
      const predAway = prediction.predicted_away_score;
      const actHome = match.home_score;
      const actAway = match.away_score;

      // Stage A: Scoreline Logic
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
          totalPoints += 100; 
        }

        const goalError = Math.abs(predHome - actHome) + Math.abs(predAway - actAway);
        if (goalError > 0) {
          const penalty = goalError * 10;
          totalPoints -= penalty; 
        }
      }

      // Stage B: Player Actions Logic
      totalPoints += calculatePlayerPoints(prediction.predicted_scorers, match.scorers || [], 100); 
      totalPoints += calculatePlayerPoints(prediction.predicted_assists, match.assists || [], 50); 

      // Update using God Mode client!
      const { error: updateErr } = await supabaseAdmin
        .from('predictions')
        .update({ points_awarded: totalPoints, status: 'graded' })
        .eq('id', prediction.id);
        
      if (updateErr) {
        console.error(`❌ [ERROR] Failed to update prediction ${prediction.id}:`, updateErr.message);
      } else {
        console.log(`✅ [SUCCESS] Graded prediction ${prediction.id} | Points: ${totalPoints}`);
      }
    });

    await Promise.all(gradePromises);
    console.log("--- Finished Grading Predictions. Starting Leaderboard Sync ---");

    // --- 5. AUTOMATIC GLOBAL LEADERBOARD UPDATE ---
    const uniqueUsers = [...new Set(predictions.map(p => p.user_id))];
    
    const profilePromises = uniqueUsers.map(async (userId) => {
      const { data: userPreds } = await supabaseAdmin
        .from('predictions')
        .select('points_awarded')
        .eq('user_id', userId);
        
      const totalScore = (userPreds || []).reduce((acc, curr) => acc + (curr.points_awarded || 0), 0);
      
      const { error: profileErr } = await supabaseAdmin
        .from('user_profiles')
        .update({ points: totalScore })
        .eq('id', userId);
        
      if (profileErr) {
        console.error(`❌ [ERROR] Failed to sync profile for user ${userId}:`, profileErr.message);
      } else {
        console.log(`📈 [SYNC] Updated user ${userId} to ${totalScore} total points.`);
      }
    });

    await Promise.all(profilePromises);
    console.log("--- Grading Run Complete! ---\n");
    // 6. Mark match as graded (Safe update)
    const { error: matchUpdateErr } = await supabaseAdmin.from('matches').update({ is_graded: true }).eq('id', body.match_id);
    if (matchUpdateErr) {
      console.warn("⚠️ [WARN] Could not update matches.is_graded (column might be missing):", matchUpdateErr.message);
    } else {
      console.log(`✅ [DONE] Match ${body.match_id} marked as graded.`);
    }

    return NextResponse.json({ 
      success: true, 
      message: `Successfully graded ${predictions.length} predictions and updated the global leaderboard!` 
    });

  } catch (error) {
    console.error("FATAL GRADING ERROR:", error);
    return handleError(error, "Grade Predictions Engine");
  }
}
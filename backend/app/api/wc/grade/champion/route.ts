import { createClient } from '@supabase/supabase-js';
import { NextResponse, NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string; 
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: NextRequest) {
  const auth = request.nextUrl.searchParams.get('auth');
  if (!process.env.CRON_SECRET || auth !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const execute = request.nextUrl.searchParams.get('execute') === 'true';

  // The official World Cup Champion
  // UPDATE THIS ONCE THE FINAL MATCH IS PLAYED
  const officialChampionName = "Spain"; 

  try {
    // 1. Fetch DB Teams to get the exact ID for the champion
    const { data: dbTeams, error: teamErr } = await supabase.from('wc_teams').select('id, name');
    if (teamErr) throw teamErr;

    const normalize = (str: string) => str.toLowerCase().replace(/[^a-z]/g, '');
    const norm = normalize(officialChampionName);
    const match = dbTeams?.find(t => normalize(t.name) === norm || norm.includes(normalize(t.name)) || normalize(t.name).includes(norm));
    
    if (!match) {
        return NextResponse.json({ 
            error: "Could not find the champion team in your database. Check spelling!", 
            unmapped_team: officialChampionName 
        }, { status: 400 });
    }

    const officialChampionId = match.id;

    // 2. Fetch ungraded Champion predictions
    // IMPORTANT: Make sure you created the 'champion_points_awarded' column and set default to 0!
    const { data: predictions, error: predErr } = await supabase
        .from('wc_knockout_predictions')
        .select('*')
        .eq('champion_points_awarded', 0);
        
    if (predErr) throw predErr;
    if (!predictions || predictions.length === 0) {
        return NextResponse.json({ status: "All users have already been graded for the Champion!" });
    }

    const userScores: Record<string, number> = {};
    const updatesToMake: { id: string, champion_points_awarded: number, matches: number }[] = [];

    // 3. Grade the predictions
    predictions.forEach(pred => {
        let correctMatches = 0;
        
        // champion_id is an int4, so we just do a direct comparison
        if (Number(pred.champion_id) === officialChampionId) {
            correctMatches = 1;
        }

        // 300 points for predicting the correct champion
        const pointsEarned = correctMatches * 300;

        updatesToMake.push({ 
            id: pred.id, 
            champion_points_awarded: pointsEarned,
            matches: correctMatches
        });

        if (!userScores[pred.user_id]) userScores[pred.user_id] = 0;
        userScores[pred.user_id] += pointsEarned;
    });

    // 4. EXECUTE Database Updates
    if (execute) {
        // A. Update Knockout Predictions table concurrently in batches of 100
        const chunkSize = 100;
        for (let i = 0; i < updatesToMake.length; i += chunkSize) {
            const chunk = updatesToMake.slice(i, i + chunkSize);
            await Promise.all(chunk.map(update => 
                supabase
                    .from('wc_knockout_predictions')
                    .update({ champion_points_awarded: update.champion_points_awarded })
                    .eq('id', update.id)
            ));
        }

        // B. Bulk update leaderboard
        const { data: currentLeaderboard } = await supabase.from('wc_leaderboard').select('user_id, points');
        const lbMap = new Map((currentLeaderboard || []).map(row => [row.user_id, row.points]));

        const finalLeaderboardUpsert = [];
        for (const [userId, points] of Object.entries(userScores)) {
            if (points > 0) {
                const existingPoints = lbMap.get(userId) || 0;
                finalLeaderboardUpsert.push({
                    user_id: userId,
                    points: existingPoints + points,
                    updated_at: new Date().toISOString()
                });
            }
        }
        
        if (finalLeaderboardUpsert.length > 0) {
            await supabase.from('wc_leaderboard').upsert(finalLeaderboardUpsert, { onConflict: 'user_id' });
        }

        return NextResponse.json({ 
            status: "SUCCESS: Champion graded and leaderboard updated!", 
            ungraded_rows_processed: updatesToMake.length,
            users_updated: Object.keys(userScores).length
        });
    }

    // 5. DRY RUN Output
    return NextResponse.json({
        status: "DRY RUN: Ready to grade.",
        ungraded_rows_found: updatesToMake.length,
        official_champion_id: officialChampionId,
        calculated_user_scores: userScores,
        detailed_updates: updatesToMake
    });

  } catch (error: any) {
     console.error("Grading Error:", error);
     return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
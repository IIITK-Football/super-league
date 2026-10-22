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

  // The official award winners
  const officialWinners = {
      goldenBall: "Rodri",
      goldenBoot: "Kylian Mbappe",
      goldenGlove: "Unai Simon"
  };

  try {
    // 1. Fetch DB Players to get the exact IDs for the winners
    const { data: dbPlayers, error: playerErr } = await supabase.from('wc_players').select('id, name');
    if (playerErr) throw playerErr;

    // Advanced normalizer to handle accents (e.g., Mbappé -> mbappe)
    const normalize = (str: string) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, '');
    
    const getPlayerId = (playerName: string) => {
        const norm = normalize(playerName);
        const match = dbPlayers?.find(p => normalize(p.name) === norm || normalize(p.name).includes(norm) || norm.includes(normalize(p.name)));
        return match ? match.id : null;
    };

    const officialIds = {
        goldenBall: getPlayerId(officialWinners.goldenBall),
        goldenBoot: getPlayerId(officialWinners.goldenBoot),
        goldenGlove: getPlayerId(officialWinners.goldenGlove),
    };

    const unmapped = [];
    if (!officialIds.goldenBall) unmapped.push(officialWinners.goldenBall);
    if (!officialIds.goldenBoot) unmapped.push(officialWinners.goldenBoot);
    if (!officialIds.goldenGlove) unmapped.push(officialWinners.goldenGlove);

    if (unmapped.length > 0) {
        return NextResponse.json({ 
            error: "Could not find these players in your database. You may need to update the spelling in the script to match your DB exactly.", 
            unmapped_players: unmapped 
        }, { status: 400 });
    }

    // 2. Fetch ungraded Award predictions
    const { data: predictions, error: predErr } = await supabase
        .from('wc_award_predictions')
        .select('*')
        .eq('points_awarded', 0);
        
    if (predErr) throw predErr;
    if (!predictions || predictions.length === 0) {
        return NextResponse.json({ status: "All users have already been graded for the Awards!" });
    }

    const userScores: Record<string, number> = {};
    const updatesToMake: { user_id: string, points_awarded: number, matches: number }[] = [];

    // 3. Grade the predictions
    predictions.forEach(pred => {
        let correctMatches = 0;
        
        if (Number(pred.golden_ball_id) === officialIds.goldenBall) correctMatches++;
        if (Number(pred.golden_boot_id) === officialIds.goldenBoot) correctMatches++;
        if (Number(pred.golden_glove_id) === officialIds.goldenGlove) correctMatches++;

        // 100 points per correct award prediction
        const pointsEarned = correctMatches * 100;

        updatesToMake.push({ 
            user_id: pred.user_id, 
            points_awarded: pointsEarned,
            matches: correctMatches
        });

        if (!userScores[pred.user_id]) userScores[pred.user_id] = 0;
        userScores[pred.user_id] += pointsEarned;
    });

    // 4. EXECUTE Database Updates
    if (execute) {
        // A. Update Award Predictions table concurrently
        const chunkSize = 100;
        for (let i = 0; i < updatesToMake.length; i += chunkSize) {
            const chunk = updatesToMake.slice(i, i + chunkSize);
            await Promise.all(chunk.map(update => 
                supabase
                    .from('wc_award_predictions')
                    .update({ points_awarded: update.points_awarded })
                    .eq('user_id', update.user_id)
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
            status: "SUCCESS: Awards graded and leaderboard updated!", 
            ungraded_rows_processed: updatesToMake.length,
            users_updated: Object.keys(userScores).length
        });
    }

    // 5. DRY RUN Output
    return NextResponse.json({
        status: "DRY RUN: Ready to grade.",
        ungraded_rows_found: updatesToMake.length,
        official_award_ids: officialIds,
        calculated_user_scores: userScores,
        detailed_updates: updatesToMake
    });

  } catch (error: any) {
     console.error("Grading Error:", error);
     return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
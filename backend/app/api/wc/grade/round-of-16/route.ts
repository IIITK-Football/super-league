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

  // The official 16 teams that qualified
  // Note: "USA" mapped to "United States" based on your previous DB mapping
  const qualifiedTeams = [
    "Canada", "Morocco", "Paraguay", "France", 
    "Brazil", "Norway", "Mexico", "England", 
    "Portugal", "Spain", "United States", "Belgium", 
    "Argentina", "Egypt", "Switzerland", "Colombia"
  ];

  try {
    // 1. Fetch DB Teams to get the exact IDs for the qualified list
    const { data: dbTeams, error: teamErr } = await supabase.from('wc_teams').select('id, name');
    if (teamErr) throw teamErr;

    const normalize = (str: string) => str.toLowerCase().replace(/[^a-z]/g, '');
    
    const qualifiedIds: number[] = [];
    const unmappedTeams: string[] = [];

    qualifiedTeams.forEach(team => {
        const norm = normalize(team);
        const match = dbTeams?.find(t => normalize(t.name) === norm || norm.includes(normalize(t.name)) || normalize(t.name).includes(norm));
        if (match) {
            qualifiedIds.push(match.id);
        } else {
            unmappedTeams.push(team);
        }
    });

    if (unmappedTeams.length > 0) {
        return NextResponse.json({ 
            error: "Could not find these teams in your database. Check spelling!", 
            unmapped_teams: unmappedTeams 
        }, { status: 400 });
    }

    // 2. Fetch ungraded predictions
    // IMPORTANT: Make sure you created the 'r16_points_awarded' column and set default to 0!
    const { data: predictions, error: predErr } = await supabase
        .from('wc_knockout_predictions')
        .select('*')
        .eq('r16_points_awarded', 0);
        
    if (predErr) throw predErr;
    if (!predictions || predictions.length === 0) {
        return NextResponse.json({ status: "All users have already been graded for Round of 16!" });
    }

    const userScores: Record<string, number> = {};
    const updatesToMake: { id: string, r16_points_awarded: number, matches: number }[] = [];

    // 3. Grade the predictions
    predictions.forEach(pred => {
        // Handle varying data types (Supabase might return JSONB as an array, or TEXT as a string)
        let predictedR16: any[] = [];
        try {
            predictedR16 = typeof pred.round_of_16 === 'string' ? JSON.parse(pred.round_of_16) : pred.round_of_16;
        } catch (e) {
            console.error(`Failed to parse round_of_16 for user ${pred.user_id}`);
            return;
        }

        // Convert all predicted IDs to numbers for safe matching
        const predictedIds = predictedR16.map(Number);
        
        // Count how many predicted IDs exist in the official qualified array
        let correctMatches = 0;
        predictedIds.forEach(id => {
            if (qualifiedIds.includes(id)) {
                correctMatches++;
            }
        });

        // 35 points per correct team
        const pointsEarned = correctMatches * 35;

        updatesToMake.push({ 
            id: pred.id, 
            r16_points_awarded: pointsEarned,
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
                    .update({ r16_points_awarded: update.r16_points_awarded })
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
            status: "SUCCESS: Round of 16 graded and leaderboard updated!", 
            ungraded_rows_processed: updatesToMake.length,
            users_updated: Object.keys(userScores).length
        });
    }

    // 5. DRY RUN Output
    return NextResponse.json({
        status: "DRY RUN: Ready to grade.",
        ungraded_rows_found: updatesToMake.length,
        official_qualified_ids: qualifiedIds,
        calculated_user_scores: userScores,
        detailed_updates: updatesToMake // Shows exact match count per row for debugging
    });

  } catch (error: any) {
     console.error("Grading Error:", error);
     return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
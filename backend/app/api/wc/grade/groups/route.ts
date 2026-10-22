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

  const officialStandings: Record<string, string[]> = {
    A: ["Mexico", "South Africa", "Korea Republic", "Czechia"],
    B: ["Switzerland", "Canada", "Bosnia-Herzegovina", "Qatar"],
    C: ["Brazil", "Morocco", "Scotland", "Haiti"],
    D: ["United States", "Australia", "Paraguay", "Türkiye"],
    E: ["Germany", "Ivory Coast", "Ecuador", "Curaçao"],
    F: ["Netherlands", "Japan", "Sweden", "Tunisia"],
    G: ["Belgium", "Egypt", "Iran", "New Zealand"], 
    H: ["Spain", "Cabo Verde", "Uruguay", "Saudi Arabia"],
    I: ["France", "Norway", "Senegal", "Iraq"],
    J: ["Argentina", "Austria", "Algeria", "Jordan"],
    K: ["Colombia", "Portugal", "Congo DR", "Uzbekistan"],
    L: ["England", "Croatia", "Ghana", "Panama"],
  };

  try {
    const { data: dbTeams, error: teamErr } = await supabase.from('wc_teams').select('id, name');
    if (teamErr) throw teamErr;

    const normalize = (str: string) => str.toLowerCase().replace(/[^a-z]/g, '');
    const getDbTeamId = (teamName: string) => {
        const norm = normalize(teamName);
        const match = dbTeams?.find(t => normalize(t.name) === norm || norm.includes(normalize(t.name)) || normalize(t.name).includes(norm));
        return match ? match.id : null;
    };

    const answerKeyIds: Record<string, {1: number | null, 2: number | null, 3: number | null, 4: number | null}> = {};
    for (const [group, teams] of Object.entries(officialStandings)) {
        answerKeyIds[group] = {
            1: getDbTeamId(teams[0]),
            2: getDbTeamId(teams[1]),
            3: getDbTeamId(teams[2]),
            4: getDbTeamId(teams[3])
        };
    }

    // CRITICAL FIX: Only fetch predictions that haven't been graded yet to prevent double points!
    const { data: predictions, error: predErr } = await supabase
        .from('wc_group_predictions')
        .select('*')
        .eq('points_awarded', 0);
        
    if (predErr) throw predErr;
    if (!predictions || predictions.length === 0) {
        return NextResponse.json({ status: "All users have already been graded!" });
    }

    const userScores: Record<string, number> = {};
    const updatesToMake: { id: string, points_awarded: number }[] = [];

    predictions.forEach(pred => {
        const groupLetter = pred.group_name.replace('Group ', '');
        const correctStandings = answerKeyIds[groupLetter];

        if (!correctStandings) return;

        let pointsEarned = 0;
        // Wrapping in Number() to guarantee strict equality passes regardless of DB type mapping
        if (Number(pred.predicted_1st_place) === correctStandings[1]) pointsEarned += 5;
        if (Number(pred.predicted_2nd_place) === correctStandings[2]) pointsEarned += 5;
        if (Number(pred.predicted_3rd_place) === correctStandings[3]) pointsEarned += 5;
        if (Number(pred.predicted_4th_place) === correctStandings[4]) pointsEarned += 5;

        updatesToMake.push({ id: pred.id, points_awarded: pointsEarned });

        if (!userScores[pred.user_id]) userScores[pred.user_id] = 0;
        userScores[pred.user_id] += pointsEarned;
    });

    if (execute) {
        // A. Update predictions table concurrently in rapid batches of 100
        const chunkSize = 100;
        for (let i = 0; i < updatesToMake.length; i += chunkSize) {
            const chunk = updatesToMake.slice(i, i + chunkSize);
            await Promise.all(chunk.map(update => 
                supabase
                    .from('wc_group_predictions')
                    .update({ points_awarded: update.points_awarded })
                    .eq('id', update.id)
            ));
        }

        // B. Bulk update leaderboard efficiently
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
            status: "SUCCESS: Remaining users graded and leaderboard updated!", 
            ungraded_rows_processed: updatesToMake.length,
            users_updated: Object.keys(userScores).length
        });
    }

    return NextResponse.json({
        status: "DRY RUN: Ready to grade the remaining users.",
        ungraded_rows_found: updatesToMake.length,
        calculated_user_scores: userScores,
    });

  } catch (error: any) {
     console.error("Grading Error:", error);
     return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
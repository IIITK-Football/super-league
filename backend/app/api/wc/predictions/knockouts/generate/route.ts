import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getOpponent } from '../../../lib/roundOf32'; 

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// The 16 "Home" slots based on the 48-team World Cup matrix
const R32_HOME_SLOTS = [
    "1A", "2A", "1B", "1C", "1D", "2D", "1E", "2E", 
    "1F", "1G", "1H", "1I", "1J", "1K", "2K", "1L"
];

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { user_id, advancing_third_place_groups } = body;

        if (!user_id || !advancing_third_place_groups || advancing_third_place_groups.length !== 8) {
            return NextResponse.json({ success: false, error: "Invalid payload. Expected 8 third-place groups." }, { status: 400 });
        }

        // 1. Fetch the user's GROUP STAGE predictions
        const { data: groupPreds, error: groupErr } = await supabase
            .from('wc_group_predictions') // Replace with your actual group predictions table name
            .select('*')
            .eq('user_id', user_id);

        if (groupErr || !groupPreds) throw new Error("Could not fetch group predictions.");

        // 2. Fetch all team details so we can attach names/logos
        const { data: teams } = await supabase.from('wc_teams').select('*');
        const teamDataMap = Object.fromEntries(teams!.map(t => [t.id, t]));

        // 3. Create a fast lookup map: e.g., positionMap["1A"] = "team-uuid-for-argentina"
        const positionMap: Record<string, string> = {};
        groupPreds.forEach(pred => {
            const letter = pred.group_name.replace('Group ', ''); // "Group A" -> "A"
            positionMap[`1${letter}`] = pred.first_place_id;
            positionMap[`2${letter}`] = pred.second_place_id;
            positionMap[`3${letter}`] = pred.third_place_id;
        });

        // 4. Generate the 16 Matches
        const roundOf32 = R32_HOME_SLOTS.map((homePosCode, index) => {
            // Use your friend's logic to find the opponent!
            const awayPosCode = getOpponent(advancing_third_place_groups, homePosCode);

            const homeTeamId = positionMap[homePosCode];
            const awayTeamId = awayPosCode ? positionMap[awayPosCode] : null;

            return {
                match_code: `M${index + 1}`,
                team1: {
                    position_code: homePosCode,
                    ...teamDataMap[homeTeamId]
                },
                team2: {
                    position_code: awayPosCode,
                    ...teamDataMap[awayTeamId!]
                }
            };
        });

        return NextResponse.json({ success: true, data: { round_of_32: roundOf32 } });

    } catch (error: any) {
        console.error("Generator Error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
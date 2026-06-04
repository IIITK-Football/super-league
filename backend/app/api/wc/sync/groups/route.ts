import { createClient } from '@supabase/supabase-js';
import { NextResponse, NextRequest } from 'next/server';

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string; 
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.API_FOOTBALL_KEY as string;
  // The get_standings action returns the groups for the World Cup
  const url = `https://apiv3.apifootball.com/?action=get_standings&league_id=28&APIkey=${apiKey}`;

  try {
    const response = await fetch(url);
    const standings = await response.json();

    if (!Array.isArray(standings)) {
      throw new Error("API did not return a valid array");
    }

    // NEW: Filter the array to ONLY include actual groups (ignoring the 3rd place rankings)
    const validGroupsOnly = standings.filter((teamData: any) => 
      teamData.league_round && teamData.league_round.startsWith('Group')
    );

    // Loop through the FILTERED standings
    const updatePromises = validGroupsOnly.map((teamData: any) => {
      const teamId = parseInt(teamData.team_id || teamData.team_key);
      const groupName = teamData.league_round; 

      return supabase
        .from('wc_teams')
        .update({ group_name: groupName })
        .eq('id', teamId);
    });

    await Promise.all(updatePromises);

    return NextResponse.json({ success: true, updated_groups: validGroupsOnly.length });
    
  } catch (error) {
    console.error("Group Sync Error:", error);
    return NextResponse.json({ error: "Failed to sync groups" }, { status: 500 });
  }
}
import { createClient } from '@supabase/supabase-js';
import { NextResponse, NextRequest } from 'next/server';

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string; 
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.API_FOOTBALL_KEY as string;
  // This endpoint returns teams AND their full player rosters
  const url = `https://apiv3.apifootball.com/?action=get_teams&league_id=28&APIkey=${apiKey}`;

  try {
    const response = await fetch(url);
    const teams = await response.json();

    // NEW SAFETY CHECK: If the API returns an error object, stop and show it!
    if (!Array.isArray(teams)) {
      console.error("API returned an unexpected response:", teams);
      return NextResponse.json({ 
        error: "API-Football request failed", 
        api_response: teams 
      }, { status: 400 });
    }

    let allPlayers: any[] = [];

    // Loop through every team, then loop through their players
    teams.forEach((team: any) => {
      if (team.players && Array.isArray(team.players)) {
        team.players.forEach((player: any) => {
          allPlayers.push({
            id: parseInt(player.player_key),
            team_id: parseInt(team.team_key), // Links to wc_teams
            name: player.player_name,
            position: player.player_type || 'Unknown'
          });
        });
      }
    });

    // Upsert all extracted players into Supabase
    let totalUpdated = 0;
    const chunkSize = 300;

    for (let i = 0; i < allPlayers.length; i += chunkSize) {
      const chunk = allPlayers.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from('wc_players')
        .upsert(chunk)
        .select();

      if (error) {
        console.error("Chunk Upsert Error:", error);
        throw error;
      }
      if (data) totalUpdated += data.length;
    }

    return NextResponse.json({ success: true, updated: totalUpdated });
    
  } catch (error: any) {
    console.error("Player Sync Error:", error);
    // Send the actual error message back to the curl response!
    return NextResponse.json({ 
      error: "Failed to sync players", 
      details: error.message || error.toString() 
    }, { status: 500 });
  }
}
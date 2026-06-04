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
  // This endpoint returns teams AND their full player rosters
  const url = `https://apiv3.apifootball.com/?action=get_teams&league_id=28&APIkey=${apiKey}`;

  try {
    const response = await fetch(url);
    const teams = await response.json();

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
    const { data, error } = await supabase
      .from('wc_players')
      .upsert(allPlayers)
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, updated: data.length });
    
  } catch (error) {
    console.error("Player Sync Error:", error);
    return NextResponse.json({ error: "Failed to sync players" }, { status: 500 });
  }
}
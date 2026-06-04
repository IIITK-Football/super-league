import { createClient } from '@supabase/supabase-js';
import { NextResponse, NextRequest } from 'next/server'; // Added NextRequest

// Added 'as string' to assure TypeScript these exist
const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string; 
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Added the type to the request parameter
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.API_FOOTBALL_KEY as string;
  const fromDate = '2026-06-11'; 
  const toDate = '2026-06-25'; 
  
  const url = `https://apiv3.apifootball.com/?action=get_events&from=${fromDate}&to=${toDate}&league_id=28&APIkey=${apiKey}`;

  try {
    const response = await fetch(url);
    const matches = await response.json();

    // Added ': any' to the match parameter
    const formattedMatches = matches.map((match: any) => ({
      id: parseInt(match.match_id),
      home_team_id: parseInt(match.match_hometeam_id),
      away_team_id: parseInt(match.match_awayteam_id),
      home_score: match.match_hometeam_score === "" ? null : parseInt(match.match_hometeam_score),
      away_score: match.match_awayteam_score === "" ? null : parseInt(match.match_awayteam_score),
      status: match.match_status,
      date: `${match.match_date}T${match.match_time}:00Z`, 
      stage: match.stage_name,
    }));

    const { data, error } = await supabase
      .from('wc_matches')
      .upsert(formattedMatches)
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, updated: data.length });
    
  } catch (error) {
    console.error("Sync Error:", error);
    return NextResponse.json({ error: "Failed to sync matches" }, { status: 500 });
  }
}   
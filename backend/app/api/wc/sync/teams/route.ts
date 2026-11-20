import { createClient } from '@supabase/supabase-js';
import { secretKey } from '@/lib/supabase/keys';

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseServiceKey = secretKey(); 
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.API_FOOTBALL_KEY as string;
  // Get all teams for League 28 (World Cup)
  const url = `https://apiv3.apifootball.com/?action=get_teams&league_id=28&APIkey=${apiKey}`;

  try {
    const response = await fetch(url);
    const teams = await response.json();

    // Map the API response to fit your wc_teams schema
    const formattedTeams = teams.map((team: any) => ({
      id: parseInt(team.team_key),
      name: team.team_name,
      logo_url: team.team_badge
    }));

    // Upsert into Supabase
    const { data, error } = await supabase
      .from('wc_teams')
      .upsert(formattedTeams)
      .select();

    if (error) throw error;

    return Response.json({ success: true, updated: data.length });
    
  } catch (error) {
    console.error("Team Sync Error:", error);
    return Response.json({ error: "Failed to sync teams" }, { status: 500 });
  }
}
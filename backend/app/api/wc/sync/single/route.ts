import { createClient } from '@supabase/supabase-js';
import { secretKey } from '@/lib/supabase/keys';

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseServiceKey = secretKey(); 
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
  // Pass a secret to protect the route, plus the name and team_id
  const searchParams = new URL(request.url).searchParams;
  const auth = searchParams.get('auth');
  const playerName = searchParams.get('name');
  const dbTeamId = searchParams.get('team_id');

  if (auth !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!playerName || !dbTeamId) {
    return Response.json({ error: 'Missing ?name=PlayerName or &team_id=123' }, { status: 400 });
  }

  try {
    // 1. Fetch specific player from your NEW API-SPORTS key
    // Note: API-Sports uses headers for authentication, unlike your old API
    const response = await fetch(`https://v3.football.api-sports.io/players?search=${playerName}`, {
      headers: {
        'x-apisports-key': process.env.API_SPORTS_KEY as string // Make sure this is in your .env
      }
    });
    
    const apiData = await response.json();

    if (!apiData.response || apiData.response.length === 0) {
      return Response.json({ error: "Player not found in API-SPORTS" }, { status: 404 });
    }

    // Grab the best match
    const playerData = apiData.response[0].player;
    const statistics = apiData.response[0].statistics[0];

    // 2. Map API-SPORTS positions to match your database exactly
    let mappedPosition = "Unknown";
    const rawPos = statistics.games.position; // "Attacker", "Midfielder", "Defender", "Goalkeeper"
    if (rawPos === "Attacker") mappedPosition = "Forwards";
    else if (rawPos === "Midfielder") mappedPosition = "Midfielders";
    else if (rawPos === "Defender") mappedPosition = "Defenders";
    else if (rawPos === "Goalkeeper") mappedPosition = "Goalkeepers";

    // 3. Create the safe player object utilizing YOUR database's Team ID
    const newPlayer = {
      id: parseInt(playerData.id) + 9000000, // Add 9 million to the ID to guarantee it never clashes with existing DB IDs
      team_id: parseInt(dbTeamId), 
      name: playerData.name,
      position: mappedPosition
    };

    // 4. Safely Upsert
    const { error } = await supabase
      .from('wc_players')
      .upsert([newPlayer], { onConflict: 'id' });

    if (error) throw error;

    return Response.json({ 
      success: true, 
      message: `${playerData.name} safely added to DB!`,
      inserted_data: newPlayer
    });
    
  } catch (error: any) {
    console.error("Single Sync Error:", error);
    return Response.json({ error: "Failed to add player", details: error.message }, { status: 500 });
  }
}
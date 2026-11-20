import { createClient } from '@supabase/supabase-js';
import { secretKey } from '@/lib/supabase/keys';

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseServiceKey = secretKey(); 
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
  const execute = new URL(request.url).searchParams.get('execute') === 'true';
  const teamId = 531; // Brazil

  // The official 26-man World Cup Squad
  const officialSquad = [
    { name: "Alisson", position: "Goalkeepers" },
    { name: "Ederson", position: "Goalkeepers" },
    { name: "Weverton", position: "Goalkeepers" },
    { name: "Alex Sandro", position: "Defenders" },
    { name: "Bremer", position: "Defenders" },
    { name: "Danilo", position: "Defenders" },
    { name: "Douglas Santos", position: "Defenders" },
    { name: "Gabriel Magalhaes", position: "Defenders" },
    { name: "Ibanez", position: "Defenders" },
    { name: "Leo Pereira", position: "Defenders" },
    { name: "Marquinhos", position: "Defenders" },
    { name: "Wesley", position: "Defenders" },
    { name: "Bruno Guimaraes", position: "Midfielders" },
    { name: "Casemiro", position: "Midfielders" },
    { name: "Danilo Santos", position: "Midfielders" },
    { name: "Fabinho", position: "Midfielders" },
    { name: "Lucas Paqueta", position: "Midfielders" },
    { name: "Endrick", position: "Forwards" },
    { name: "Gabriel Martinelli", position: "Forwards" },
    { name: "Igor Thiago", position: "Forwards" },
    { name: "Luiz Henrique", position: "Forwards" },
    { name: "Matheus Cunha", position: "Forwards" },
    { name: "Neymar Junior", position: "Forwards" },
    { name: "Raphinha", position: "Forwards" },
    { name: "Rayan", position: "Forwards" },
    { name: "Vinicius Junior", position: "Forwards" }
  ];

  try {
    // 1. Fetch all players currently in the DB for Brazil
    const { data: existingPlayers, error: fetchError } = await supabase
      .from('wc_players')
      .select('id, name, position')
      .eq('team_id', teamId);

    if (fetchError) throw fetchError;

    // Helper function to normalize names (removes spaces, accents, and casing) for safer matching
    const normalize = (str: string) => str.toLowerCase().replace(/[^a-z]/g, '');
    const existingNamesNormalized = existingPlayers?.map(p => normalize(p.name)) || [];

    // 2. Separate into "Already Here" and "Missing"
    const alreadyInDb: any[] = [];
    const missingFromDb: any[] = [];

    // Starting safe ID block just for Brazil missing players
    let safeIdCounter = 99053101; 

    officialSquad.forEach(player => {
      const normName = normalize(player.name);
      
      // Check if a variation of this name already exists in the DB
      // E.g., Matches "Vinicius Jr" with "Vinicius Junior" if parts overlap
      const isAlreadyInDb = existingNamesNormalized.some(dbName => 
        dbName.includes(normName) || normName.includes(dbName)
      );

      if (isAlreadyInDb) {
        alreadyInDb.push(player.name);
      } else {
        missingFromDb.push({
          id: safeIdCounter++,
          team_id: teamId,
          name: player.name,
          position: player.position
        });
      }
    });

    // 3. If ?execute=true is passed, actually insert the missing players!
    let insertionResult = "DRY RUN: No players were added. Add ?execute=true to the URL to insert them.";
    if (execute && missingFromDb.length > 0) {
      const { error: insertError } = await supabase
        .from('wc_players')
        .upsert(missingFromDb);

      if (insertError) throw insertError;
      insertionResult = `SUCCESS: ${missingFromDb.length} missing players were injected into the database!`;
    }

    // 4. Print out the beautiful summary to the screen
    return Response.json({
      status: insertionResult,
      total_official_squad: officialSquad.length,
      currently_in_database: existingPlayers?.length || 0,
      already_matched: alreadyInDb,
      missing_to_be_added: missingFromDb.map(m => m.name),
      raw_database_dump: existingPlayers // Shows you exactly what the DB sees
    });

  } catch (error: any) {
    console.error("Smart Sync Error:", error);
    return Response.json({ error: "Failed to sync", details: error.message }, { status: 500 });
  }
}
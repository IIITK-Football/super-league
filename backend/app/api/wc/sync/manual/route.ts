import { createClient } from '@supabase/supabase-js';
import { secretKey } from '@/lib/supabase/keys';

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseServiceKey = secretKey(); 
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET() {
  // Safe mapping of Brazil's squad using distinct custom IDs to prevent prediction clashes
  const brazilSquad = [
    // Goalkeepers
    { id: 990001, team_id: 531, name: "Alisson", position: "Goalkeepers" },
    { id: 990003, team_id: 531, name: "Weverton", position: "Goalkeepers" },
    { id: 990023, team_id: 531, name: "Neymar Junior", position: "Forwards" }
  ];

  try {
    // We use standard upsert on 'id'. This inserts players if missing, 
    // or safely updates their details if the ID somehow matches, protecting original rows.
    const { data, error } = await supabase
      .from('wc_players')
      .upsert(brazilSquad, { onConflict: 'id' })
      .select();

    if (error) throw error;

    return Response.json({ 
      success: true, 
      message: "Brazil squad update executed successfully!",
      affected_rows: data?.length || 0 
    });
    
  } catch (error: any) {
    console.error("Manual Injection Error:", error);
    return Response.json({ 
      error: "Failed to inject Brazil players", 
      details: error.message 
    }, { status: 500 });
  }
}
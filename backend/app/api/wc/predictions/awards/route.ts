import { jobClient } from '@/lib/supabase/clients';

export const dynamic = 'force-dynamic';

// Set the global deadline

// GET: Retrieve a user's award predictions
export async function GET(request: Request) {
  const supabase = jobClient();
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    if (!userId) {
      return Response.json({ error: "Missing user_id parameter" }, { status: 400 });
    }

    const { data: awardData, error } = await supabase
      .from('wc_award_predictions')
      .select('*')
      .eq('user_id', userId)
      .single();

    // PGRST116 means no rows were found (the user hasn't predicted yet), which is completely fine
    if (error && error.code !== 'PGRST116') throw error;
    if (!awardData) return Response.json({ success: true, data: null });

    // Fetch player names
    const playerIds = [awardData.golden_boot_id, awardData.golden_ball_id, awardData.golden_glove_id].filter(Boolean);
    
    if (playerIds.length > 0) {
      const { data: playersData } = await supabase
        .from('wc_players')
        .select('id, name')
        .in('id', playerIds);
        
      if (playersData) {
        awardData.golden_boot = playersData.find(p => p.id === awardData.golden_boot_id);
        awardData.golden_ball = playersData.find(p => p.id === awardData.golden_ball_id);
        awardData.golden_glove = playersData.find(p => p.id === awardData.golden_glove_id);
      }
    }

    return Response.json({ success: true, data: awardData });
  } catch (error) {
    console.error("Fetch Awards Error:", error);
    return Response.json({ error: "Failed to fetch award predictions" }, { status: 500 });
  }
}

// Closed archive (D-02): the World Cup prediction deadline passed on 2026-06-22, and every submission has been refused
// since. The old write path trusted a body user_id and wrote with the secret key, so it is gone; only the refusal is
// served, with the same status and body.
export async function POST() {
  return Response.json({ success: false, error: 'Deadline passed. Predictions are locked.' }, { status: 403 });
}
import { createClient } from '@supabase/supabase-js';
import { secretKey } from '@/lib/supabase/keys';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseServiceKey = secretKey(); 
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Set the global deadline
const PREDICTION_DEADLINE = new Date('2026-06-22T00:00:00Z');

// GET: Retrieve a user's award predictions
export async function GET(request: Request) {
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

// POST: Save or update a user's award predictions (Secured)
export async function POST(request: Request) {
  console.log("AWARDS POST HIT");

  try {
    // 1. DEADLINE CHECK
    if (new Date() > PREDICTION_DEADLINE) {
      return Response.json({ success: false, error: 'Deadline passed. Predictions are locked.' }, { status: 403 });
    }

    const body = await request.json();
    const { user_id, golden_boot_id, golden_ball_id, golden_glove_id } = body;

    if (!user_id) {
       return Response.json({ error: 'Missing user_id' }, { status: 400 });
    }

    // 2. ONE-TIME SUBMISSION CHECK
    // See if the user already has an award prediction in the database
    const { data: existingRecord } = await supabase
      .from('wc_award_predictions')
      .select('user_id')
      .eq('user_id', user_id)
      .single();

    if (existingRecord) {
      return Response.json({ success: false, error: 'Predictions have already been submitted and cannot be changed.' }, { status: 403 });
    }

    // 3. IF SAFE, SAVE TO DATABASE
    const upsertData = {
      user_id,
      golden_boot_id: golden_boot_id || null,
      golden_ball_id: golden_ball_id || null,
      golden_glove_id: golden_glove_id || null,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('wc_award_predictions')
      .upsert(upsertData, {
        onConflict: 'user_id' // Uses the primary key to find existing rows
      })
      .select();

    if (error) throw error;

    return Response.json({ success: true, data: data[0] });

  } catch (error) {
    console.error("Award Prediction Error:", error);
    return Response.json({ error: "Failed to save award predictions" }, { status: 500 });
  }
}
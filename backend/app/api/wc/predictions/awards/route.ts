import { createClient } from '@supabase/supabase-js';
import { NextResponse, NextRequest } from 'next/server';

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string; 
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// GET: Retrieve a user's award predictions
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    if (!userId) {
      return NextResponse.json({ error: "Missing user_id parameter" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('wc_award_predictions')
      .select('*')
      .eq('user_id', userId)
      .single(); // We use .single() because there is only one row per user

    // PGRST116 means no rows were found (the user hasn't predicted yet), which is completely fine
    if (error && error.code !== 'PGRST116') throw error;

    return NextResponse.json({ success: true, data: data || null });
  } catch (error) {
    console.error("Fetch Awards Error:", error);
    return NextResponse.json({ error: "Failed to fetch award predictions" }, { status: 500 });
  }
}

// POST: Save or update a user's award predictions
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, golden_boot_id, golden_ball_id, golden_glove_id } = body;

    if (!user_id) {
       return NextResponse.json({ error: 'Missing user_id' }, { status: 400 });
    }

    // Upsert the prediction (inserts if new, updates if it already exists)
    const { data, error } = await supabase
      .from('wc_award_predictions')
      .upsert({
        user_id,
        golden_boot_id: golden_boot_id || null,
        golden_ball_id: golden_ball_id || null,
        golden_glove_id: golden_glove_id || null,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id' // Uses the primary key to find existing rows
      })
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data: data[0] });

  } catch (error) {
    console.error("Award Prediction Error:", error);
    return NextResponse.json({ error: "Failed to save award predictions" }, { status: 500 });
  }
}
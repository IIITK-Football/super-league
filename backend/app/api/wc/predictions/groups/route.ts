import { createClient } from '@supabase/supabase-js';
import { secretKey } from '@/lib/supabase/keys';
import { NextResponse, NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseServiceKey = secretKey(); 
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Set the global deadline
const PREDICTION_DEADLINE = new Date('2026-06-22T00:00:00Z');

export async function POST(request: NextRequest) {
  console.log("GROUP POST HIT");
  try {
    // 1. DEADLINE CHECK
    if (new Date() > PREDICTION_DEADLINE) {
      return NextResponse.json({ success: false, error: 'Deadline passed. Predictions are locked.' }, { status: 403 });
    }

    const body = await request.json();
    const { user_id, predictions } = body;

    // predictions should be an array of objects from the frontend
    if (!user_id || !Array.isArray(predictions) || predictions.length === 0) {
       return NextResponse.json({ success: false, error: 'Invalid payload data' }, { status: 400 });
    }

    // 2. ONE-TIME SUBMISSION CHECK
    // Look for any existing group prediction for this user
    const { data: existingRecords } = await supabase
      .from('wc_group_predictions')
      .select('user_id')
      .eq('user_id', user_id)
      .limit(1);

    if (existingRecords && existingRecords.length > 0) {
      return NextResponse.json({ success: false, error: 'Predictions have already been submitted and cannot be changed.' }, { status: 403 });
    }

    // 3. IF SAFE, FORMAT AND SAVE TO DATABASE
    const formattedPredictions = predictions.map((pred: any) => ({
      user_id,
      group_name: pred.group_name,
      predicted_1st_place: pred.first_place_id,
      predicted_2nd_place: pred.second_place_id,
      predicted_3rd_place: pred.third_place_id,
      predicted_4th_place: pred.fourth_place_id,
      updated_at: new Date().toISOString()
    }));

    // Upsert the entire array into Supabase at once
    const { data, error } = await supabase
      .from('wc_group_predictions')
      .upsert(formattedPredictions, {
        onConflict: 'user_id,group_name' 
      })
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, saved_count: data ? data.length : formattedPredictions.length });

  } catch (error: any) {
    console.error("Group Prediction Error:", error);
    return NextResponse.json({ success: false, error: error.message || "Failed to save group predictions" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    // Grab the user_id from the URL query
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    if (!userId) {
      return NextResponse.json({ success: false, error: "Missing user_id parameter" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('wc_group_predictions')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;

    // Format to match API spec
    const formattedData = data.map(d => ({
      ...d,
      first_place_id: d.predicted_1st_place,
      second_place_id: d.predicted_2nd_place,
      third_place_id: d.predicted_3rd_place,
      fourth_place_id: d.predicted_4th_place
    }));

    return NextResponse.json({ success: true, data: formattedData });
  } catch (error: any) {
    console.error("Group Prediction Fetch Error:", error);
    return NextResponse.json({ success: false, error: error.message || "Failed to fetch predictions" }, { status: 500 });
  }
}
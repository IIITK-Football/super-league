import { createClient } from '@supabase/supabase-js';
import { NextResponse, NextRequest } from 'next/server';

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string; 
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, predictions } = body;

    // predictions should be an array of objects from the frontend
    if (!user_id || !Array.isArray(predictions) || predictions.length === 0) {
       return NextResponse.json({ error: 'Invalid payload data' }, { status: 400 });
    }

    // Format the data to match our new schema
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
        onConflict: 'user_id, group_name' 
      })
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, saved_count: data.length });

  } catch (error) {
    console.error("Group Prediction Error:", error);
    return NextResponse.json({ error: "Failed to save group predictions" }, { status: 500 });
  }
}


export async function GET(request: NextRequest) {
  try {
    // Grab the user_id from the URL query (e.g., /api/wc/predictions/groups?user_id=123)
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    if (!userId) {
      return NextResponse.json({ error: "Missing user_id parameter" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('wc_group_predictions')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Fetch Predictions Error:", error);
    return NextResponse.json({ error: "Failed to fetch predictions" }, { status: 500 });
  }
}
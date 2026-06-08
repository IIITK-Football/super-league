import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!
);

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { user_id, predictions } = body;

    if (!user_id || !predictions || !Array.isArray(predictions)) {
      return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
    }

    const upsertData = predictions.map((p: any) => ({
      user_id,
      group_name: p.group_name,
      predicted_1st_place: p.first_place_id,
      predicted_2nd_place: p.second_place_id,
      predicted_3rd_place: p.third_place_id,
      predicted_4th_place: p.fourth_place_id,
      updated_at: new Date().toISOString()
    }));

    const { error } = await supabase
      .from('wc_group_predictions')
      .upsert(upsertData, { onConflict: 'user_id,group_name' });

    if (error) throw error;

    return NextResponse.json({ success: true, saved_count: upsertData.length });
  } catch (error: any) {
    console.error("Group Prediction Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const user_id = searchParams.get('user_id');

    if (!user_id) {
      return NextResponse.json({ success: false, error: 'user_id required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('wc_group_predictions')
      .select('*')
      .eq('user_id', user_id);

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
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

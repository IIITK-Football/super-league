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
    const { user_id, golden_boot_id, golden_ball_id, golden_glove_id } = body;

    if (!user_id) {
      return NextResponse.json({ success: false, error: 'user_id is required' }, { status: 400 });
    }

    const upsertData = {
      user_id,
      golden_boot_id: golden_boot_id || null,
      golden_ball_id: golden_ball_id || null,
      golden_glove_id: golden_glove_id || null,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('wc_award_predictions')
      .upsert(upsertData, { onConflict: 'user_id' });

    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Award predictions saved' });
  } catch (error: any) {
    console.error("Award Prediction Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

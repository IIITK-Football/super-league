import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string; 
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET() {
  try {
    // 1. Get the user IDs who predicted Spain (ID 19)
    const { data: predictions, error: predErr } = await supabase
      .from('wc_knockout_predictions')
      .select('user_id') 
      .eq('champion_id', 19);

    if (predErr) throw predErr;

    const userIds = predictions.map(row => row.user_id);

    // 2. Fetch the names from the user_profiles table using those IDs
    const { data: profiles, error: profErr } = await supabase
      .from('user_profiles')
      .select('name') // Note: If your column is called 'full_name' or 'username', change 'name' to match it
      .in('id', userIds);

    if (profErr) throw profErr;

    // 3. Clean up the output to just be an array of names
    const predictorNames = profiles.map(p => p.name);

    return NextResponse.json({
        total_predictors: predictorNames.length,
        names: predictorNames
    });

  } catch (error: any) {
     return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
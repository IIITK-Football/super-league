import { createClient } from '@supabase/supabase-js';
import { NextResponse, NextRequest } from 'next/server';

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string; 
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function PATCH(request: NextRequest) {
  try {
    // 1. Parse the incoming request from the frontend
    const body = await request.json();
    const { user_id, wc_team_flair } = body;

    // 2. Validate that the frontend sent the required data
    if (!user_id || !wc_team_flair) {
      return NextResponse.json(
        { error: 'Missing user_id or wc_team_flair' }, 
        { status: 400 }
      );
    }

    // 3. Update the user_profiles table in Supabase
    const { data, error } = await supabase
      .from('user_profiles')
      .update({ wc_team_flair: wc_team_flair })
      .eq('id', user_id) // Make sure we only update this specific user
      .select();

    if (error) throw error;

    // 4. Return the updated profile data to confirm success
    return NextResponse.json({ success: true, profile: data[0] });

  } catch (error) {
    console.error("Flair Update Error:", error);
    return NextResponse.json(
      { error: "Failed to update World Cup flair" }, 
      { status: 500 }
    );
  }
}
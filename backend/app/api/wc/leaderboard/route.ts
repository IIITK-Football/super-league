import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET() {
  try {
    // This query pulls the fantasy points and joins it with the user's profile info
    const { data, error } = await supabase
      .from('wc_leaderboard')
      .select(`
        points,
        updated_at,
        user_profiles ( nickname, real_name, wc_team_flair )
      `)
      .order('points', { ascending: false }); // Highest scores at the top

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Leaderboard Error:", error);
    return NextResponse.json({ error: "Failed to fetch leaderboard" }, { status: 500 });
  }
}
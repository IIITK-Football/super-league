import { createClient } from '@supabase/supabase-js';
import { secretKey } from '@/lib/supabase/keys';

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = secretKey();
const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET() {
  try {
    // This query pulls the fantasy points and joins it with the user's profile info
    const { data, error } = await supabase
      .from('wc_leaderboard')
      .select(`
        user_id,
        points,
        updated_at,
        user_profiles ( nickname, real_name, wc_team_flair )
      `)
      .order('points', { ascending: false }); // Highest scores at the top

    if (error) throw error;

    return Response.json({ success: true, data });
  } catch (error) {
    console.error("Leaderboard Error:", error);
    return Response.json({ error: "Failed to fetch leaderboard" }, { status: 500 });
  }
}
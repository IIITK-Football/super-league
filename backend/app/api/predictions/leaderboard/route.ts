export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { publishableKey } from '@/lib/supabase/keys';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { handleError } from '../../../../lib/errorHandler';

export async function GET() {
  try {
    const cookieStore = await cookies();
    
    const supabase = createServerClient(
      process.env.SUPABASE_URL!,
      publishableKey(),
      {
        cookies: { getAll() { return cookieStore.getAll() }, setAll() {} },
      }
    );

    // 1. Fetch the top 100 users, including both new flair columns
    const { data: profiles, error } = await supabase
      .from('user_profiles')
      .select('id, nickname, real_name, email, points, mens_team_flair, womens_team_flair')
      .gt('points', 0)
      .order('points', { ascending: false })
      .limit(100);

    if (error) throw error;

    // 2. Map BOTH flairs to the frontend
    const overall = profiles.map(p => ({
      user_id: p.id,
      username: p.nickname || p.real_name || p.email?.split('@')[0] || `Fan_${p.id.substring(0, 5)}`,
      total_points: p.points || 0,
      mens_team_flair: p.mens_team_flair || null,
      womens_team_flair: p.womens_team_flair || null
    }));

    return NextResponse.json({
      success: true,
      data: {
        overall: overall,
        top_scorers_predictor: [],
        top_assists_predictor: []
      }
    });

  } catch (error) {
    console.error("Leaderboard Fetch Error:", error);
    return handleError(error, "Fetch Leaderboards");
  }
}
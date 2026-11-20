import { createServerClient } from '@supabase/ssr';
import { handleError } from '../../../lib/errorHandler'; 
import { resolveScope } from '@/lib/scope';
import { noCookies } from '@/lib/http';

// Turn off caching temporarily so you can test the Mens/Womens toggle instantly!
export const revalidate = 0; 

export async function GET(request: Request) {
  try {
    // ?division=<slug>&season=<slug or id>; without a season, the division's current season.
    const { searchParams } = new URL(request.url);

    const cookieStore = noCookies;
    const supabase = createServerClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          },
        },
      }
    );

    const scope = await resolveScope(supabase, { division: searchParams.get('division'), season: searchParams.get('season') });

    // Every season reads season_player_stats, the single source of season statistics (it also counts goals that
    // Freshers seasons recorded only in the match JSON), so every viewer sees the same numbers.
    // Top 10 scorers and assisters of this season
    const shape = (r: any) => ({ id: r.player_id, name: r.name, club: r.club, goalsScored: r.goals, assists: r.assists });
    const { data: scorerRows, error: scorersErr } = await supabase
      .from('season_player_stats')
      .select('player_id, name, club, goals, assists')
      .eq('season_id', scope.season.id)
      .order('goals', { ascending: false })
      .order('name', { ascending: true })
      .limit(10); 

    if (scorersErr) throw scorersErr;

    const { data: assistRows, error: assistsErr } = await supabase
      .from('season_player_stats')
      .select('player_id, name, club, goals, assists')
      .eq('season_id', scope.season.id)
      .order('assists', { ascending: false })
      .order('name', { ascending: true })
      .limit(10); 

    if (assistsErr) throw assistsErr;
    const topScorers = (scorerRows ?? []).map(shape);
    const topAssists = (assistRows ?? []).map(shape);

    // Send both lists neatly packaged together!
    return Response.json({
      success: true,
      message: "Leaderboard fetched successfully",
      data: {
        topScorers: topScorers || [],
        topAssists: topAssists || []
      }
    });

  } catch (error) {
    return handleError(error, "Leaderboard API Fetch");
  }
}
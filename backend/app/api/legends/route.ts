import { publishableKey } from '@/lib/supabase/keys';
import { createServerClient } from '@supabase/ssr';
import { handleError } from '../../../lib/errorHandler'; 
import { noCookies } from '@/lib/http';

export const dynamic = 'force-dynamic'; 

export async function GET() {
  try {
    const cookieStore = noCookies;
    const supabase = createServerClient(
      process.env.SUPABASE_URL!,
      publishableKey(),
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          },
        },
      }
    );

    // All-time leaders: each player's goals and assists added up across every season.
    const { data: rows, error } = await supabase
      .from('season_player_stats')
      .select('player_id, name, club, goals, assists');

    // If Supabase throws an error, it gets caught immediately by the catch block
    if (error) throw error;

    const byPlayer = new Map<string, { id: string; name: string; club: string | null; goalsScored: number; assists: number }>();
    for (const r of rows ?? []) {
      const p = byPlayer.get(r.player_id) ?? { id: r.player_id, name: r.name, club: r.club, goalsScored: 0, assists: 0 };
      p.goalsScored += r.goals;
      p.assists += r.assists;
      byPlayer.set(r.player_id, p);
    }
    const data = [...byPlayer.values()]
      .sort((a, b) => b.goalsScored - a.goalsScored || a.name.localeCompare(b.name))
      .slice(0, 10);

    return Response.json({
      success: true,
      message: "Legends fetched successfully",
      data: data
    });

  } catch (error) {
    // Pass the raw error and a context string to our new central utility!
    return handleError(error, "Legends API Fetch");
  }
}
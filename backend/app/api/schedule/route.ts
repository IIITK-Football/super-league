import { NextResponse } from 'next/server';
import { publishableKey } from '@/lib/supabase/keys';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const cookieStore = await cookies();
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

    // Fetch upcoming/live matches from the matches table directly
    // (includes team IDs needed for player filtering)
    const { data, count, error } = await supabase
      .from('matches')
      .select(`
        id, date, venue, status, home_score, away_score,
        home_team:teams!matches_home_team_id_fkey ( id, name ),
        away_team:teams!matches_away_team_id_fkey ( id, name )
      `, { count: 'exact' })
      .in('status', ['upcoming', 'live', 'scheduled'])
      .order('date', { ascending: true })
      .range(from, to);

    if (error) throw error;

    const totalPages = count ? Math.ceil(count / limit) : 0;

    const shaped = (data || []).map((m: any) => ({
      id: m.id,
      date: m.date,
      venue: m.venue,
      status: m.status,
      home_score: m.home_score,
      away_score: m.away_score,
      home_team: m.home_team?.name || 'TBD',
      away_team: m.away_team?.name || 'TBD',
      home_team_id: m.home_team?.id || null,
      away_team_id: m.away_team?.id || null,
    }));

    return NextResponse.json({
      success: true,
      data: shaped,
      meta: {
        total_items: count,
        total_pages: totalPages,
        current_page: page,
        items_per_page: limit
      }
    });

  } catch (error) {
    console.error("Schedule fetch error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch schedule" },
      { status: 500 }
    );
  }
}
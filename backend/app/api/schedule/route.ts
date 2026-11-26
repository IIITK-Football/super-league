import { requestClient } from '@/lib/supabase/clients';
import { resolveScope } from '@/lib/scope';
import { handleError } from '@/lib/errorHandler';
import { OPEN_STATUSES } from '@/lib/matchStatus';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    // Paging is at least one page of one row (0 or a negative number would ask for an invalid range).
    const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1);
    const limit = Math.max(1, parseInt(searchParams.get('limit') || '10') || 10);

    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const supabase = requestClient(request);

    // The selected division's season (?division=<slug>&season=<slug or id>; default its current season)
    const scope = await resolveScope(supabase, { division: searchParams.get('division'), season: searchParams.get('season') }, { section: 'fixtures' });

    // Fetch upcoming/live matches from the matches table directly
    // (includes team IDs needed for player filtering)
    const { data, count, error } = await supabase
      .from('matches')
      .select(`
        id, date, venue, status, home_score, away_score,
        home_team:teams!matches_home_team_id_fkey ( id, name ),
        away_team:teams!matches_away_team_id_fkey ( id, name )
      `, { count: 'exact' })
      .eq('season_id', scope.season.id)
      .in('status', OPEN_STATUSES)
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

    return Response.json({
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
    return handleError(error, 'Schedule');
  }
}
import { publicClient } from '@/lib/supabase/clients';
import { scopeFromUrl } from '@/lib/scope';
import { handleError } from '../../../../../lib/errorHandler';

export const revalidate = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ team_id: string }> }
) {
  const supabase = publicClient();
  try {
    const { team_id } = await params;

    const searchParams = new URL(request.url).searchParams;
    let query = supabase
      .from('matches')
      .select(`
        id, date, venue, status, home_score, away_score,
        season:seasons!inner(section_flags),
        home_team:teams!matches_home_team_id_fkey ( id, name, logo_url ),
        away_team:teams!matches_away_team_id_fkey ( id, name, logo_url )
      `)
      .or(`home_team_id.eq.${team_id},away_team_id.eq.${team_id}`)
      .order('date', { ascending: false });

    if (searchParams.has('division') || searchParams.has('season')) {
      const scope = await scopeFromUrl(supabase, request, { section: 'teams' });
      query = query.eq('season_id', scope.season.id);
    }
    const { data, error } = await query;
    if (error) throw error;

    const matches = (data || []).filter((m: any) => m.season?.section_flags?.teams).map((m: any) => ({
      id: m.id,
      date: m.date,
      venue: m.venue,
      status: m.status,
      home_score: m.home_score,
      away_score: m.away_score,
      home_team: m.home_team?.name || 'TBD',
      away_team: m.away_team?.name || 'TBD',
      home_team_id: m.home_team?.id,
      away_team_id: m.away_team?.id,
    }));

    return Response.json({ success: true, data: matches });
  } catch (error) {
    return handleError(error, 'Fetch Team Matches');
  }
}

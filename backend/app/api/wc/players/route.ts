import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { handleError } from '../../../../lib/errorHandler';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!
);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const position = searchParams.get('position');

    let dbQuery = supabase
      .from('wc_players')
      .select('id, name, position, team_id, wc_teams(name)')
      .limit(15);

    if (position) {
      if (position === 'GK') {
        dbQuery = dbQuery.eq('position', 'Goalkeepers');
      } else {
        dbQuery = dbQuery.eq('position', position);
      }
    }

    if (query) {
      // Because Supabase OR doesn't work well across joins out of the box,
      // we'll try to find teams matching the query first
      const { data: teamsData } = await supabase
        .from('wc_teams')
        .select('id')
        .ilike('name', `%${query}%`);
      
      const teamIds = teamsData?.map(t => t.id) || [];
      
      if (teamIds.length > 0) {
        // If team matches, return players from those teams OR matching player names
        const teamIdsStr = `(${teamIds.join(',')})`;
        dbQuery = dbQuery.or(`name.ilike.%${query}%,team_id.in.${teamIdsStr}`);
      } else {
        // Otherwise just search player names
        dbQuery = dbQuery.ilike('name', `%${query}%`);
      }
    }

    const { data, error } = await dbQuery;
    
    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error: any) {
    console.error('Player search error:', error);
    return handleError(error, 'Fetch WC Players');
  }
}

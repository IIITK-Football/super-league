import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { handleError } from '../../../lib/errorHandler';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get('team_id');

    let query = supabase
      .from('players')
      .select(`
        id,
        first_name,
        last_name,
        position,
        jersey_number,
        image_url,
        assists,
        team_id,
        teams ( id, name )
      `)
      .order('position', { ascending: true })
      .order('last_name', { ascending: true });

    if (teamId) {
      query = query.eq('team_id', teamId);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Shape each player into a clean flat object for the frontend
    const players = (data || []).map((p: any) => ({
      id: p.id,
      name: `${p.first_name} ${p.last_name}`,
      first_name: p.first_name,
      last_name: p.last_name,
      position: p.position,
      jersey_number: p.jersey_number,
      image_url: p.image_url,
      assists: p.assists ?? 0,
      team_id: p.team_id,
      team: p.teams?.name || null,
    }));

    return NextResponse.json({ success: true, data: players });
  } catch (error) {
    return handleError(error, 'Fetch Players');
  }
}

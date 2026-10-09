import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { handleError } from '../../../lib/errorHandler';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!
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
      `);

    let freshersQuery = supabase
      .from('team_members')
      .select(`
        id,
        first_name,
        last_name,
        name,
        position,
        jersey_number,
        image_url,
        team_registrations!inner ( team_id, team_name )
      `);

    if (teamId) {
      query = query.eq('team_id', teamId);
      freshersQuery = freshersQuery.eq('team_registrations.team_id', teamId);
    }

    const [playersRes, freshersRes] = await Promise.all([query, freshersQuery]);

    if (playersRes.error) throw playersRes.error;
    if (freshersRes.error) throw freshersRes.error;

    // Shape regular players
    const regularPlayers = (playersRes.data || []).map((p: any) => ({
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

    // Shape freshers
    const freshers = (freshersRes.data || []).map((p: any) => ({
      id: p.id,
      name: p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
      first_name: p.first_name,
      last_name: p.last_name,
      position: p.position,
      jersey_number: p.jersey_number,
      image_url: p.image_url,
      assists: 0,
      team_id: p.team_registrations?.team_id || null,
      team: p.team_registrations?.team_name || null,
    }));

    // Combine and sort
    const allPlayers = [...regularPlayers, ...freshers].sort((a, b) => {
      // Basic sorting by position then last name to match previous behavior
      if (a.position !== b.position) {
        return (a.position || '').localeCompare(b.position || '');
      }
      return (a.last_name || '').localeCompare(b.last_name || '');
    });

    return NextResponse.json({ success: true, data: allPlayers });
  } catch (error) {
    return handleError(error, 'Fetch Players');
  }
}

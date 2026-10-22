import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { handleError } from '../../../../../lib/errorHandler';

export const revalidate = 60;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ team_id: string }> }
) {
  try {
    const { team_id } = await params;
    // team_id is interpolated into .or() below, so reject anything but an id
    if (!/^[\w-]+$/.test(team_id)) throw { status: 400, message: 'Invalid team id' };

    const { data, error } = await supabase
      .from('matches')
      .select(`
        id, date, venue, status, home_score, away_score,
        home_team:teams!matches_home_team_id_fkey ( id, name, logo_url ),
        away_team:teams!matches_away_team_id_fkey ( id, name, logo_url )
      `)
      .or(`home_team_id.eq.${team_id},away_team_id.eq.${team_id}`)
      .order('date', { ascending: false });

    if (error) throw error;

    const matches = (data || []).map((m: any) => ({
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

    return NextResponse.json({ success: true, data: matches });
  } catch (error) {
    return handleError(error, 'Fetch Team Matches');
  }
}

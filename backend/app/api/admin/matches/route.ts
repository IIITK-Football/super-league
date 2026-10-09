import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { handleError } from '../../../../lib/errorHandler';

// Turn off caching so the admin sees live updates instantly!
export const revalidate = 0;

// 1. THE MAGIC FIX: Teach the client to read the Auth Header!
async function getSupabaseClient(request: Request) {
  const cookieStore = await cookies();
  const authHeader = request.headers.get('Authorization'); 

  return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    cookies: { getAll() { return cookieStore.getAll() }, setAll() {} },
    global: {
      headers: {
        Authorization: authHeader || '', 
      },
    },
  });
}

// 2. PASS `request` INTO THE GET ROUTE
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const division = searchParams.get('division') || 'mens';

    const supabase = await getSupabaseClient(request); 

    let query = supabase
      .from('matches')
      .select(`
        id, 
        home_team_id, 
        away_team_id, 
        home_score, 
        away_score, 
        status, 
        division,
        minute,
        is_graded,
        home:teams!home_team_id(id, name),
        away:teams!away_team_id(id, name)
      `)
      .eq('division', division);

    if (status) {
      const statusArray = status.split(',');
      query = query.in('status', statusArray);
    }

    const { data, error } = await query.order('date', { ascending: true });

    if (error) throw error;

    const formattedData = data?.map((m:any) => {
      // MAGIC FIX: Check if Supabase returned an array or an object!
      const homeData = Array.isArray(m.home) ? m.home[0] : m.home;
      const awayData = Array.isArray(m.away) ? m.away[0] : m.away;

      return {
        ...m,
        home_team_id: homeData?.id || m.home_team_id,
        away_team_id: awayData?.id || m.away_team_id,
        home_team_name: homeData?.name || 'Unknown',
        away_team_name: awayData?.name || 'Unknown'
      };
    });

    return NextResponse.json({ success: true, data: formattedData });
  } catch (error) {
    return handleError(error, "Fetch Matches");
  }
}

// 3. PASS `request` INTO THE POST ROUTE
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const supabase = await getSupabaseClient(request); 

    const isWalkover = body.is_walkover === true;
    const walkoverWinner = body.walkover_winner; // 'home' or 'away'
    
    let initialStatus = isWalkover ? 'completed' : 'scheduled';
    let initialHomeScore = 0;
    let initialAwayScore = 0;

    if (isWalkover) {
      if (walkoverWinner === 'home') initialHomeScore = 3;
      else if (walkoverWinner === 'away') initialAwayScore = 3;
    }

    const { data, error } = await supabase
      .from('matches')
      .insert([{
        home_team_id: body.home_team_id,
        away_team_id: body.away_team_id,
        date: body.date,
        venue: body.venue,
        division: body.division,
        status: initialStatus, 
        home_score: initialHomeScore,
        away_score: initialAwayScore
      }])
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, message: "Match scheduled successfully", data });
  } catch (error) {
    return handleError(error, "Admin Create Match");
  }
}

// UPDATE A MATCH (Reschedule date/venue or fix teams)
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    
    if (!body.id) throw { status: 400, message: "Match ID is required for updates." };

    const supabase = await getSupabaseClient(request);

    const { data, error } = await supabase
      .from('matches')
      .update({
        home_team_id: body.home_team_id,
        away_team_id: body.away_team_id,
        date: body.date,
        venue: body.venue
      })
      .eq('id', body.id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, message: "Match rescheduled successfully", data });
  } catch (error) {
    return handleError(error, "Admin Update Match");
  }
}

// DELETE A MATCH (Cancel a game entirely from the database)
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) throw { status: 400, message: "Match ID is required for deletion." };

    const supabase = await getSupabaseClient(request);

    const { error } = await supabase
      .from('matches')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true, message: "Match deleted successfully" });
  } catch (error) {
    return handleError(error, "Admin Delete Match");
  }
}
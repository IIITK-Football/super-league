import { requestClient } from '@/lib/supabase/clients';
import { handleError } from '../../../../lib/errorHandler';
import { resolveScope } from '@/lib/scope';

// Turn off caching so the admin sees live updates instantly!
// The caller's client (D-04): publishable key plus their token, so RLS and the audit actor are theirs.
async function getSupabaseClient(request: Request) {
  return requestClient(request);
}

// 2. PASS `request` INTO THE GET ROUTE
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    const supabase = await getSupabaseClient(request);
    // D-04: at most three sequential rounds. Round 1: who is calling, and which season (?division=<slug>&season=<slug
    // or id>; without a season, the division's current season).
    const [{ data: { user } }, { data: isDictator, error: roleError }, scope] = await Promise.all([
      supabase.auth.getUser(),
      supabase.rpc('is_dictator'),
      resolveScope(supabase, { division: searchParams.get('division'), season: searchParams.get('season') }),
    ]);
    if (!user) throw { status: 401, message: "Unauthorized: Please log in." };
    if (roleError) throw roleError;

    let query = supabase
      .from('matches')
      .select(`
        id, 
        home_team_id, 
        away_team_id, 
        home_score, 
        away_score, 
        status, 
        season_id,
        date,
        venue,
        minute,
        timer_start_time,
        timer_calibration,
        is_graded,
        result_kind,
        events_version,
        home:teams!home_team_id(id, name),
        away:teams!away_team_id(id, name)
      `)
      .eq('season_id', scope.season.id);

    if (status) {
      const statusArray = status.split(',');
      query = query.in('status', statusArray);
    }

    // Round 2: the season's matches and, for a dictator, the completed graded matches whose events changed after
    // grading (they need a regrade).
    const [{ data, error }, stale] = await Promise.all([
      query.order('date', { ascending: true }),
      isDictator ? supabase.rpc('matches_needing_regrade', { p_season: scope.season.id }) : Promise.resolve({ data: [] }),
    ]);
    if (error) throw error;
    const needsRegrade = new Set<string>(((stale as { data: unknown }).data ?? []) as string[]);

    // Round 3: the dashboard lists matches for scoring. A dictator sees them all, a scorer only the matches assigned to
    // them (their season or one match, unexpired). Anyone else sees none.
    let visible = data ?? [];
    if (!isDictator && visible.length > 0) {
      const { data: ids, error: idsError } = await supabase.rpc('scorable_match_ids', { p_ids: visible.map((m: any) => m.id) });
      if (idsError) throw idsError;
      const allowed = new Set<string>((ids ?? []) as string[]);
      visible = visible.filter((m: any) => allowed.has(m.id));
    }

    const formattedData = visible.map((m:any) => {
      // MAGIC FIX: Check if Supabase returned an array or an object!
      const homeData = Array.isArray(m.home) ? m.home[0] : m.home;
      const awayData = Array.isArray(m.away) ? m.away[0] : m.away;

      return {
        ...m,
        home_team_id: homeData?.id || m.home_team_id,
        away_team_id: awayData?.id || m.away_team_id,
        home_team_name: homeData?.name || 'Unknown',
        away_team_name: awayData?.name || 'Unknown',
        needs_regrade: needsRegrade.has(m.id),
        division_name: scope.division.name,
        season_name: scope.season.name
      };
    });

    return Response.json({ success: true, data: formattedData });
  } catch (error) {
    return handleError(error, "Fetch Matches");
  }
}

// 3. PASS `request` INTO THE POST ROUTE
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const supabase = await getSupabaseClient(request); 
    // The match belongs to body.season (slug or id) of body.division (slug), or that division's current season.
    const scope = await resolveScope(supabase, { division: body.division, season: body.season });

    // A match is created at 0-0. A walkover or forfeit is then awarded explicitly: a required reason and the awarded
    // score (3-0 to the winner by default, which the dictator may change); it has no goal events.
    const isAward = body.is_walkover === true;
    const kind = body.result_kind === 'forfeit' ? 'forfeit' : 'walkover';
    const reason = String(body.walkover_reason ?? body.result_reason ?? '').trim();
    if (isAward && !reason) throw { status: 400, message: 'A walkover or forfeit needs a reason.' };
    const winner = body.walkover_winner; // 'home' or 'away'
    if (isAward && winner !== 'home' && winner !== 'away') throw { status: 400, message: 'Choose which team was awarded the result.' };
    const awardHome = Number.isInteger(body.awarded_home) ? body.awarded_home : winner === 'home' ? 3 : 0;
    const awardAway = Number.isInteger(body.awarded_away) ? body.awarded_away : winner === 'away' ? 3 : 0;

    // An awarded match is created and awarded in one transaction (D-04): both or neither.
    const { data, error } = isAward
      ? await supabase.rpc('create_awarded_match', {
          p_season: scope.season.id,
          p_home_team: body.home_team_id,
          p_away_team: body.away_team_id,
          p_date: body.date ?? null,
          p_venue: body.venue ?? null,
          p_kind: kind,
          p_home: awardHome,
          p_away: awardAway,
          p_reason: reason,
        }).single()
      : await supabase
          .from('matches')
          .insert([{
            home_team_id: body.home_team_id,
            away_team_id: body.away_team_id,
            date: body.date,
            venue: body.venue,
            season_id: scope.season.id,
            status: 'scheduled',
          }])
          .select()
          .single();

    if (error) throw error;
    return Response.json({ success: true, message: "Match scheduled successfully", data });
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

    if (error) {
      // The database refuses changing the teams of a match that has events: say so instead of a generic failure.
      if ((error as { code?: string }).code === '23514') throw { status: 409, message: (error as { message: string }).message };
      throw error;
    }
    return Response.json({ success: true, message: "Match rescheduled successfully", data });
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
    return Response.json({ success: true, message: "Match deleted successfully" });
  } catch (error) {
    return handleError(error, "Admin Delete Match");
  }
}
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { handleError } from '../../../../../lib/errorHandler'; // Adjust path if needed

// FIX 1: Add ': Request' to the parameter
async function getSupabaseClient(request: Request) {
  const cookieStore = await cookies();
  const authHeader = request.headers.get('Authorization'); 

  return createServerClient(
    // FIX 2: Explicitly cast env variables as strings
    process.env.SUPABASE_URL as string, 
    process.env.SUPABASE_ANON_KEY as string, 
    {
      cookies: { getAll() { return cookieStore.getAll() }, setAll() {} },
      global: {
        headers: {
          Authorization: authHeader || '', 
        },
      },
    }
  );
}

// FIX 1: Add ': Request' to the parameter
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { match_id, action, player_id, team_id, minute } = body;

    if (!match_id || !action) {
      throw { status: 400, message: "match_id and action are required." };
    }

    const supabase = await getSupabaseClient(request); 

    // Security check
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      throw { status: 401, message: "Unauthorized: Please log in." };
    }

    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .in('role', ['admin', 'dictator', 'captain'])
      .limit(1)
      .single();

    if (!roleData) {
      throw { status: 403, message: "Forbidden: Admin clearance required." };
    }

    // Fetch the current state of the match
    const { data: match, error: matchErr } = await supabase
      .from('matches')
      .select('*')
      .eq('id', match_id)
      .single();

    if (matchErr || !match) throw { status: 404, message: "Match not found." };

    // FIX 3: Tell TypeScript this object can hold any properties we add later
    let updatePayload: Record<string, any> = { updated_at: new Date().toISOString() };
    let responseMessage = "Match updated.";

    // THE ACTION SWITCHBOARD
    switch (action) {
      case 'add_goal':
        if (!player_id || !team_id) throw { status: 400, message: "player_id and team_id required for a goal." };
        
        const isHomePlayer = match.home_team_id === team_id;
        
        if (body.is_own_goal) {
          updatePayload.home_score = !isHomePlayer ? (match.home_score || 0) + 1 : match.home_score;
          updatePayload.away_score = isHomePlayer ? (match.away_score || 0) + 1 : match.away_score;
          
          const currentOwnGoals = match.own_goals || [];
          updatePayload.own_goals = [...currentOwnGoals, player_id];
          
          responseMessage = "Own Goal registered! Point awarded to the opposition.";
        } else {
          updatePayload.home_score = isHomePlayer ? (match.home_score || 0) + 1 : match.home_score;
          updatePayload.away_score = !isHomePlayer ? (match.away_score || 0) + 1 : match.away_score;
          
          const currentScorers = match.scorers || [];
          updatePayload.scorers = [...currentScorers, player_id];

          if (body.assist_id) {
            const currentAssists = match.assists || [];
            updatePayload.assists = [...currentAssists, body.assist_id];

            const { data: assistPlayer } = await supabase.from('players').select('assists').eq('id', body.assist_id).single();
            await supabase.from('players').update({ assists: (assistPlayer?.assists || 0) + 1 }).eq('id', body.assist_id);
          }
          responseMessage = "Goal registered successfully!";
        }
        updatePayload.status = 'live';
        
        await supabase.from('goals').insert([{ 
          match_id: match_id, 
          player_id: player_id, 
          team_id: team_id,
          minute: body.minute || null,
          assist_id: body.assist_id || null,
          is_own_goal: body.is_own_goal || false
        }]);
        break;
        
      case 'add_assist':
        if (!player_id) throw { status: 400, message: "player_id required for an assist." };
        const currentAssists = match.assists || [];
        updatePayload.assists = [...currentAssists, player_id];
        responseMessage = "Assist registered successfully!";
        break;

      case 'update_time':
        updatePayload.status = 'live';
        if (body.minute !== undefined) {
          updatePayload.minute = body.minute;
        }
        if (body.timer_start_time !== undefined) {
          updatePayload.timer_start_time = body.timer_start_time;
        }
        if (body.timer_calibration !== undefined) {
          updatePayload.timer_calibration = body.timer_calibration;
        }
        responseMessage = `Match clock synced to ${body.minute}`;
        break;

      case 'half_time':
        updatePayload.status = 'live'; 
        updatePayload.minute = 'HT';
        responseMessage = "Match paused for Half Time!";
        break;

      case 'close_match':
        updatePayload.status = 'completed';
        updatePayload.minute = 'FT';
        if (body.home_penalties !== undefined && body.away_penalties !== undefined) {
          updatePayload.home_penalties = body.home_penalties;
          updatePayload.away_penalties = body.away_penalties;
        }
        responseMessage = "Match officially closed! Ready for grading.";
        break;
      
      case 'delete_goal':
        if (!body.goal_id) throw { status: 400, message: "goal_id is required to delete." };

        const { data: goalToDelete, error: goalFetchErr } = await supabase
          .from('goals')
          .select('*')
          .eq('id', body.goal_id)
          .single();

        if (goalFetchErr || !goalToDelete) throw { status: 404, message: "Goal not found." };

        const isHomeTeam = match.home_team_id === goalToDelete.team_id;

        if (goalToDelete.is_own_goal) {
          updatePayload.home_score = !isHomeTeam ? Math.max(0, (match.home_score || 0) - 1) : match.home_score;
          updatePayload.away_score = isHomeTeam ? Math.max(0, (match.away_score || 0) - 1) : match.away_score;
          
          const ogIndex = (match.own_goals || []).indexOf(goalToDelete.player_id);
          if (ogIndex > -1) {
             const newOg = [...match.own_goals];
             newOg.splice(ogIndex, 1);
             updatePayload.own_goals = newOg;
          }
        } else {
          updatePayload.home_score = isHomeTeam ? Math.max(0, (match.home_score || 0) - 1) : match.home_score;
          updatePayload.away_score = !isHomeTeam ? Math.max(0, (match.away_score || 0) - 1) : match.away_score;
          
          const scorerIndex = (match.scorers || []).indexOf(goalToDelete.player_id);
          if (scorerIndex > -1) {
             const newScorers = [...match.scorers];
             newScorers.splice(scorerIndex, 1);
             updatePayload.scorers = newScorers;
          }

          if (goalToDelete.assist_id) {
             const assistIndex = (match.assists || []).indexOf(goalToDelete.assist_id);
             if (assistIndex > -1) {
                const newAssists = [...match.assists];
                newAssists.splice(assistIndex, 1);
                updatePayload.assists = newAssists;
             }
             const { data: aPlayer } = await supabase.from('players').select('assists').eq('id', goalToDelete.assist_id).single();
             if (aPlayer) {
                await supabase.from('players').update({ assists: Math.max(0, (aPlayer.assists || 0) - 1) }).eq('id', goalToDelete.assist_id);
             }
          }
        }

        await supabase.from('goals').delete().eq('id', body.goal_id);
        responseMessage = "Goal deleted and score adjusted.";
        break;

      case 'edit_goal':
        throw { status: 501, message: "Edit is handled via deleting and re-adding currently. (For backend safety)" };

      default:
        throw { status: 400, message: "Unknown action type." };
    }

    const { data: updatedMatch, error: updateErr } = await supabase
      .from('matches')
      .update(updatePayload)
      .eq('id', match_id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    return NextResponse.json({ 
      success: true, 
      message: responseMessage, 
      data: updatedMatch 
    });

  } catch (error) {
    return handleError(error, "Live Match Controller");
  }
}
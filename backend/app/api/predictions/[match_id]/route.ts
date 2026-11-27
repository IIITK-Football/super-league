import { publicClient, requestClient } from '@/lib/supabase/clients';
import { ScopeError } from '@/lib/scope';
import { handleError } from '../../../../lib/errorHandler'; 
import { MATCH_STATUS } from '@/lib/matchStatus';

// The caller's client (D-04): publishable key plus their token, so RLS decides.
async function getSupabaseClient(request: Request) {
  return requestClient(request);
}

async function checkFantasySection(matchId: string) {
  const { data, error } = await publicClient().from('matches')
    .select('season:seasons!inner(section_flags)').eq('id', matchId).maybeSingle();
  if (error) throw error;
  const season = data?.season as unknown as { section_flags?: Record<string, boolean> } | undefined;
  if (!season?.section_flags?.fantasy) throw new ScopeError(404, 'This section is not available for this season');
}

// ==========================================
// GET: Fetch existing prediction for a match
// ==========================================
export async function GET(
  request: Request,
  { params }: { params: Promise<{ match_id: string }> } 
) {
  try {
    const { match_id } = await params;
    
    // Use the helper so it knows who is asking!
    const supabase = await getSupabaseClient(request);

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw { status: 401, message: "Unauthorized" };

    const [, { data, error }] = await Promise.all([
      checkFantasySection(match_id),
      supabase.from('predictions').select('*').eq('user_id', user.id).eq('match_id', match_id).maybeSingle(),
    ]);

    if (error) throw error;

    return Response.json({ 
      success: true, 
      has_predicted: !!data,
      data: data || null 
    });

  } catch (error) {
    return handleError(error, "Fetch User Prediction");
  }
}
// ==========================================
// POST: Save a new prediction for a match
// ==========================================
export async function POST(
  request: Request,
  { params }: { params: Promise<{ match_id: string }> }
) {
  try {
    const { match_id } = await params;
    const body = await request.json();
    
    // Use the helper to read the VIP Token!
    const supabase = await getSupabaseClient(request);

    // 1. Verify User is actually logged in
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw { status: 401, message: 'Unauthorized: You must be logged in to predict.' };
    }

    // 2. The scores are whole numbers, and the match is still open: scheduled, and before kickoff
    const isScore = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
    if (!isScore(body.predicted_home_score) || !isScore(body.predicted_away_score)) {
      throw { status: 400, message: 'Scores must be whole numbers, zero or more.' };
    }
    const [{ data: match, error: matchError }, { data: existingPrediction, error: existingError }] = await Promise.all([
      publicClient().from('matches').select('status, date, season:seasons!inner(section_flags)').eq('id', match_id).maybeSingle(),
      supabase.from('predictions').select('id').eq('user_id', user.id).eq('match_id', match_id).maybeSingle(),
    ]);
    if (matchError) throw matchError;
    if (!match) throw { status: 404, message: 'Match not found.' };
    const season = match.season as unknown as { section_flags?: Record<string, boolean> } | undefined;
    if (!season?.section_flags?.fantasy) throw new ScopeError(404, 'This section is not available for this season');
    if (match.status !== MATCH_STATUS.scheduled || new Date(match.date).getTime() <= Date.now()) {
      throw { status: 400, message: 'Predictions are closed for this match.' };
    }

    if (existingError) throw existingError;

    if (existingPrediction) {
      throw { status: 400, message: "Nice try! You have already predicted this match." };
    }

    // 4. Insert the Prediction into the database
    const { data, error } = await supabase
      .from('predictions')
      .insert([{
        user_id: user.id,
        match_id: match_id,
        predicted_home_score: body.predicted_home_score,
        predicted_away_score: body.predicted_away_score,
        predicted_scorers: body.predicted_scorers,
        predicted_assists: body.predicted_assists,
        status: 'pending' 
      }])
      .select()
      .single();

    if (error) throw error;

    return Response.json({ success: true, message: "Prediction locked in!", data });

  } catch (error) {
    return handleError(error, "Submit Prediction");
  }
}
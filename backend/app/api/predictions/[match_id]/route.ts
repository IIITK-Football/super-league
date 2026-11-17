import { NextResponse } from 'next/server';
import { publishableKey } from '@/lib/supabase/keys';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { handleError } from '../../../../lib/errorHandler'; 

// 1. THE MAGIC FIX: Helper to read the Auth Header from the frontend!
async function getSupabaseClient(request: Request) {
  const cookieStore = await cookies();
  const authHeader = request.headers.get('Authorization'); 

  return createServerClient(process.env.SUPABASE_URL!, publishableKey(), {
    cookies: { getAll() { return cookieStore.getAll() }, setAll() {} },
    global: {
      headers: {
        Authorization: authHeader || '', 
      },
    },
  });
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

    const { data, error } = await supabase
      .from('predictions')
      .select('*')
      .eq('user_id', user.id)
      .eq('match_id', match_id)
      .maybeSingle(); 

    if (error) throw error;

    return NextResponse.json({ 
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

    // 2. MAGIC FIX: Check if they already predicted this match!
    const { data: existingPrediction } = await supabase
      .from('predictions')
      .select('id')
      .eq('user_id', user.id)
      .eq('match_id', match_id)
      .maybeSingle();

    if (existingPrediction) {
      throw { status: 400, message: "Nice try! You have already predicted this match." };
    }

    // 3. Insert the Prediction into the database
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

    return NextResponse.json({ success: true, message: "Prediction locked in!", data });

  } catch (error) {
    return handleError(error, "Submit Prediction");
  }
}
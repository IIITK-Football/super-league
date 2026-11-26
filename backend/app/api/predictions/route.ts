import { requestClient } from '@/lib/supabase/clients';
import { handleError } from '../../../lib/errorHandler';
import { z } from 'zod';

// 1. ZOD SCHEMA WITH ADVANCED MATH VALIDATION
const predictionSchema = z.object({
  match_id: z.string().uuid("Invalid Match ID"),
  predicted_home_score: z.number().min(0),
  predicted_away_score: z.number().min(0),
  predicted_scorers: z.array(z.string()).default([]),
  predicted_assists: z.array(z.string()).default([])
}).refine((data) => {
  // Make sure the length of the scorers array equals the total predicted goals
  const totalGoals = data.predicted_home_score + data.predicted_away_score;
  return data.predicted_scorers.length === totalGoals;
}, {
  message: "The number of goalscorers must exactly match the total predicted goals.",
  path: ["predicted_scorers"]
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validatedData = predictionSchema.parse(body);
    const supabase = requestClient(request);

    // 2. SECURE THE ROUTE: Only logged-in fans can predict
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw { status: 401, message: "Unauthorized: You must be logged in to predict." };

    // 3. THE UPSERT: Insert if new, Update if exists
    const { data, error } = await supabase
      .from('predictions')
      .upsert({
        user_id: user.id,
        match_id: validatedData.match_id,
        predicted_home_score: validatedData.predicted_home_score,
        predicted_away_score: validatedData.predicted_away_score,
        predicted_scorers: validatedData.predicted_scorers,
        predicted_assists: validatedData.predicted_assists,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id, match_id' // Uses the unique constraint we built in the last ticket!
      })
      .select()
      .single();

    if (error) throw error;
    return Response.json({ success: true, message: "Prediction locked in!", data });

  } catch (error) {
    return handleError(error, "Submit Prediction");
  }
}
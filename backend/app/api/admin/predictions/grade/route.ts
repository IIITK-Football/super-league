import { jobClient } from '@/lib/supabase/clients';
import { handleError } from '../../../../../lib/errorHandler';
import { callerClient } from '@/lib/roster/access';
import { gradeMatch, GradingError } from '@/lib/grading';

// Grades one completed match from its match events. Dictator only (grading writes everyone's points, with the server
// key, so the caller is checked first). Repeating it gives the same points and records the events version graded at.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.match_id) throw { status: 400, message: 'match_id is required for grading.' };
    if (!process.env.SUPABASE_SECRET_KEY) {
      return Response.json({ success: false, message: 'Server configuration error: SUPABASE_SECRET_KEY is missing.' }, { status: 500 });
    }

    const supabase = await callerClient(request);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw { status: 401, message: 'Unauthorized' };
    const { data: isDictator } = await supabase.rpc('is_dictator');
    if (!isDictator) throw { status: 403, message: 'Only a dictator can grade predictions.' };

    const admin = jobClient();
    const graded = await gradeMatch(admin, body.match_id);
    return Response.json({ success: true, message: graded ? `Graded ${graded} predictions from the match events.` : 'No predictions found for this match.' });
  } catch (error) {
    if (error instanceof GradingError) return Response.json({ success: false, message: error.message }, { status: error.status });
    return handleError(error, 'Grade Predictions Engine');
  }
}

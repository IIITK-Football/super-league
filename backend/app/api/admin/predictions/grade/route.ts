import { handleError } from '../../../../../lib/errorHandler';
import { callerClient } from '@/lib/roster/access';

// Grades one completed match from its match events. Dictator only. The database function grade_match does the work in
// one call as the caller (D-04): it checks the dictator, grades every prediction, records the events version graded
// at, and the audit history names the dictator. Repeating it gives the same points.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.match_id) throw { status: 400, message: 'match_id is required for grading.' };

    const supabase = await callerClient(request);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw { status: 401, message: 'Unauthorized' };

    const { data: graded, error } = await supabase.rpc('grade_match', { p_match: body.match_id });
    if (error) {
      if (error.code === '42501') throw { status: 403, message: 'Only a dictator can grade predictions.' };
      throw error;
    }
    return Response.json({ success: true, message: graded ? `Graded ${graded} predictions from the match events.` : 'No predictions found for this match.' });
  } catch (error) {
    return handleError(error, 'Grade Predictions Engine');
  }
}

import { handleError } from '../../../../../lib/errorHandler';
import { callerClient } from '@/lib/roster/access';

// Regrades every completed match that already has graded predictions, from its match events. Dictator only. One
// database call as the caller (regrade_all_predictions, D-04), so it stays within the Worker's request limits however
// many matches there are, and the audit history names the dictator. Safe to repeat.
export async function POST(request: Request) {
  try {
    const supabase = await callerClient(request);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw { status: 401, message: 'Unauthorized' };

    const { data: regraded, error } = await supabase.rpc('regrade_all_predictions');
    if (error) {
      if (error.code === '42501') throw { status: 403, message: 'Only a dictator can regrade predictions.' };
      throw error;
    }
    if (!regraded) return Response.json({ success: true, message: 'No graded predictions found to regrade.' });
    return Response.json({ success: true, message: `Regraded ${regraded} predictions from the match events; season leaderboards follow the new points.` });
  } catch (error) {
    return handleError(error, 'Regrade Predictions');
  }
}

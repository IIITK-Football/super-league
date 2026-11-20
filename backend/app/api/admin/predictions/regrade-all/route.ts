import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { handleError } from '../../../../../lib/errorHandler';
import { callerClient } from '@/lib/roster/access';
import { gradeMatch } from '@/lib/grading';

// Regrades every completed match that already has graded predictions, from its match events. Dictator only. Safe to
// repeat: points are overwritten with the same values.
export async function POST(request: Request) {
  try {
    if (!process.env.SUPABASE_SECRET_KEY) {
      return NextResponse.json({ success: false, message: 'Server configuration error: SUPABASE_SECRET_KEY is missing.' }, { status: 500 });
    }
    const supabase = await callerClient(request);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw { status: 401, message: 'Unauthorized' };
    const { data: isDictator } = await supabase.rpc('is_dictator');
    if (!isDictator) throw { status: 403, message: 'Only a dictator can regrade predictions.' };

    const admin = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: matches, error } = await admin.from('matches').select('id').eq('status', 'completed');
    if (error) throw error;
    if (!matches?.length) return NextResponse.json({ success: true, message: 'No completed matches found to regrade.' });

    let regraded = 0;
    for (const m of matches) regraded += await gradeMatch(admin, m.id as string, { onlyGraded: true });
    return NextResponse.json({ success: true, message: `Regraded ${regraded} predictions from the match events; season leaderboards follow the new points.` });
  } catch (error) {
    return handleError(error, 'Regrade Predictions');
  }
}

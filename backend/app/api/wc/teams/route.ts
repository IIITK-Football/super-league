import { jobClient } from '@/lib/supabase/clients';
import { handleError } from '../../../../lib/errorHandler';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = jobClient();
  try {
    const { data: teams, error } = await supabase
      .from('wc_teams')
      .select('id, name, logo_url, group_name')
      .not('group_name', 'is', null) // Ensures we only get teams assigned to groups
      .order('group_name', { ascending: true })
      .order('name', { ascending: true }); // Alphabetical within each group

    if (error) throw error;

    return Response.json({ success: true, data: teams || [] });
  } catch (error: any) {
    console.error("Fetch Teams Error:", error);
    // Using your centralized error handler
    return handleError(error, 'Fetch WC Teams');
  }
}
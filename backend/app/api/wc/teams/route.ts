import { createClient } from '@supabase/supabase-js';
import { secretKey } from '@/lib/supabase/keys';
import { handleError } from '../../../../lib/errorHandler';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = secretKey();
const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET() {
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
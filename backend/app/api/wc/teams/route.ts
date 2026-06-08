import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { handleError } from '../../../../lib/errorHandler';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('wc_teams')
      .select('id, name, logo_url, group_name')
      .order('group_name', { ascending: true })
      .order('id', { ascending: true });
      
    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error: any) {
    console.error('Fetch wc_teams error:', error);
    return handleError(error, 'Fetch WC Teams');
  }
}

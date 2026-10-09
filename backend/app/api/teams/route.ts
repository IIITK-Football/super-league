import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { handleError } from '../../../lib/errorHandler';

export const revalidate = 0; 

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const division = searchParams.get('division');
    const all = searchParams.get('all');

    let query = supabase
      .from('teams')
      .select('id, name, logo_url, team_color')
      .order('name', { ascending: true });

    if (!all) {
      query = query.eq('division', division || 'mens');
    }

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return handleError(error, 'Fetch Teams');
  }
}
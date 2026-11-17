import { NextResponse } from 'next/server';
import { publishableKey } from '@/lib/supabase/keys';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { handleError } from '../../../lib/errorHandler';

export const revalidate = 0; 

export async function GET() {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(process.env.SUPABASE_URL!, publishableKey(), {
      cookies: { getAll() { return cookieStore.getAll() }, setAll() {} },
    });

    // Fetch the active poll and join the related poll_options in one query!
    const { data, error } = await supabase
      .from('polls')
      .select('*, poll_options(*)')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 just means no rows found

    return NextResponse.json({ success: true, data: data || null });

  } catch (error) {
    return handleError(error, "Fetch Active Poll");
  }
}
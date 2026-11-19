import { NextResponse } from 'next/server';
import { publishableKey } from '@/lib/supabase/keys';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { handleError } from '../../../../lib/errorHandler';

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(process.env.SUPABASE_URL!, publishableKey(), {
      cookies: { getAll() { return cookieStore.getAll() }, setAll() {} },
    });

    // 1. SECURE THE ROUTE: Verify the admin is logged in (Since GET requests bypass the proxy mutation check)
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw { status: 401, message: "Unauthorized: Admins only." };

    // 2. PARALLEL QUERIES: Fire all counts at the exact same time!
    const [
      { count: totalPlayers },
      { count: upcomingMatches }
    ] = await Promise.all([
      supabase.from('players').select('id', { count: 'exact', head: true }),
      supabase.from('matches').select('*', { count: 'exact', head: true }).eq('status', 'scheduled')
    ]);

    // 3. RETURN THE DASHBOARD PAYLOAD
    return NextResponse.json({
      success: true,
      message: "Admin stats retrieved",
      data: {
        totalPlayers: totalPlayers || 0,
        upcomingMatches: upcomingMatches || 0
      }
    });

  } catch (error) {
    return handleError(error, "Admin Dashboard Stats Aggregation");
  }
}
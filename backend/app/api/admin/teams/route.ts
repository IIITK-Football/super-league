import { NextResponse } from 'next/server';
import { publishableKey } from '@/lib/supabase/keys';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { handleError } from '../../../../lib/errorHandler';

// The Magic Fix for Middleware
async function getSupabaseClient(request: Request) {
  const cookieStore = await cookies();
  const authHeader = request.headers.get('Authorization');

  return createServerClient(process.env.SUPABASE_URL!, publishableKey(), {
    cookies: { getAll() { return cookieStore.getAll() }, setAll() {} },
    global: { headers: { Authorization: authHeader || '' } },
  });
}

// CREATE A TEAM
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const supabase = await getSupabaseClient(request);

    const { data, error } = await supabase
      .from('teams')
      .insert([{
        name: body.name,
        short_name: body.short_name,
        division: body.division,
        logo_url: body.logo_url || null
      }])
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, message: "Team created successfully", data });
  } catch (error) {
    return handleError(error, "Admin Create Team");
  }
}

// DELETE A TEAM
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) throw { status: 400, message: "Team ID is required." };

    const supabase = await getSupabaseClient(request);

    const { error } = await supabase
      .from('teams')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true, message: "Team deleted successfully" });
  } catch (error) {
    return handleError(error, "Admin Delete Team");
  }
}
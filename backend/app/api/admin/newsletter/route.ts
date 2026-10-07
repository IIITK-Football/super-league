import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { handleError } from '../../../../lib/errorHandler';
// Note: Zod is removed here to keep it simple, but you can add it back if you have it installed!

// 1. THE MAGIC FIX: Teach the client to read the Auth Header!
async function getSupabaseClient(request: Request) {
  const cookieStore = await cookies();
  const authHeader = request.headers.get('Authorization'); // Grab the VIP Pass from the frontend!

  return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    cookies: { getAll() { return cookieStore.getAll() }, setAll() {} },
    global: {
      headers: {
        Authorization: authHeader || '', // Force Supabase to use the token!
      },
    },
  });
}

async function requireRole(request: Request, allowedRoles: string[]) {
  const supabase = await getSupabaseClient(request);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw { status: 401, message: 'Unauthorized' };

  const { data: roleRecord } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  const role = roleRecord?.role;
  if (!allowedRoles.includes(role)) throw { status: 403, message: 'Insufficient role' };
  return { supabase, user };
}

// CREATE AN ARTICLE
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { supabase, user } = await requireRole(request, ['editor', 'dictator', 'admin']);

    const { data, error } = await supabase
      .from('newsletter')
      .insert([{
        title: body.title,
        summary: body.summary,
        author: user.email || user.id, 
        image_url: body.image_url || null,
        content: body.content || [], 
        category: body.category || 'Official Editorial',
        date: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, message: "Article published", data });
  } catch (error) {
    return handleError(error, "Admin Create Article");
  }
}

// DELETE AN ARTICLE
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) throw { status: 400, message: "Article ID is required for deletion." };

    const { supabase } = await requireRole(request, ['dictator', 'admin']);

    const { error } = await supabase
      .from('newsletter')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true, message: "Article deleted successfully" });
  } catch (error) {
    return handleError(error, "Admin Delete Article");
  }
}

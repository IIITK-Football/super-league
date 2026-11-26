import { requestClient } from '@/lib/supabase/clients';
import { handleError } from '../../../../lib/errorHandler';
import { hasAnyRole, myRoles, type Role } from '../../../../lib/auth/roles';
// Note: Zod is removed here to keep it simple, but you can add it back if you have it installed!

// The caller's client (D-04): publishable key plus their token, so RLS and the audit actor are theirs.
async function getSupabaseClient(request: Request) {
  return requestClient(request);
}

async function requireRole(request: Request, allowedRoles: string[]) {
  const supabase = await getSupabaseClient(request);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw { status: 401, message: 'Unauthorized' };

  const roles = await myRoles(supabase);
  if (!hasAnyRole(roles, allowedRoles as Role[])) throw { status: 403, message: 'Insufficient role' };
  return { supabase, user };
}

// CREATE AN ARTICLE
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { supabase, user } = await requireRole(request, ['editor', 'dictator']);

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
    return Response.json({ success: true, message: "Article published", data });
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

    const { supabase } = await requireRole(request, ['dictator']);

    const { error } = await supabase
      .from('newsletter')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return Response.json({ success: true, message: "Article deleted successfully" });
  } catch (error) {
    return handleError(error, "Admin Delete Article");
  }
}

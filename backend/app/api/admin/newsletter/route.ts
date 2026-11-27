import { requestClient } from '@/lib/supabase/clients';
import { handleError } from '../../../../lib/errorHandler';
import { hasAnyRole, myRoles, type Role } from '../../../../lib/auth/roles';

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

// The fields an editor or dictator writes. Title and summary are required; the author and date are never client-set.
function articleFields(body: any) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const summary = typeof body?.summary === 'string' ? body.summary.trim() : '';
  if (!title) throw { status: 400, message: 'An article needs a title.' };
  if (title.length > 255) throw { status: 400, message: 'The title must be 255 characters or fewer.' };
  if (!summary) throw { status: 400, message: 'An article needs a summary.' };
  if (body.content !== undefined && !Array.isArray(body.content)) throw { status: 400, message: 'The article content must be a list of blocks.' };
  return {
    title,
    summary,
    category: body.category || 'Official Editorial',
    image_url: body.image_url || null,
    content: body.content || [],
  };
}

async function readBody(request: Request) {
  try {
    return await request.json();
  } catch {
    throw { status: 400, message: 'The request body must be JSON.' };
  }
}

// CREATE AN ARTICLE
export async function POST(request: Request) {
  try {
    const fields = articleFields(await readBody(request));
    const { supabase, user } = await requireRole(request, ['editor', 'dictator']);

    // The byline is the publisher's public display name, never their email or account id: the article and its history
    // are public. The database refuses an author that looks like an email address (newsletter_author_not_email).
    const { data: profile } = await supabase.from('user_profiles').select('nickname, real_name').eq('id', user.id).maybeSingle();
    const author = profile?.nickname?.trim() || profile?.real_name?.trim() || 'Super League Editorial';

    const { data, error } = await supabase
      .from('newsletter')
      .insert([{
        ...fields,
        author,
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

// EDIT AN ARTICLE (editors and dictators; deleting stays dictator-only)
export async function PUT(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) throw { status: 400, message: "Article ID is required." };
    const fields = articleFields(await readBody(request));
    const { supabase } = await requireRole(request, ['editor', 'dictator']);

    const { data, error } = await supabase
      .from('newsletter')
      .update(fields)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) throw { status: 404, message: "Article not found." };
    return Response.json({ success: true, message: "Article updated", data });
  } catch (error) {
    return handleError(error, "Admin Update Article");
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

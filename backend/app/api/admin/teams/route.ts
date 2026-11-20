import { publishableKey } from '@/lib/supabase/keys';
import { createServerClient } from '@supabase/ssr';
import { handleError } from '../../../../lib/errorHandler';
import { resolveScope } from '@/lib/scope';
import { noCookies } from '@/lib/http';

// The Magic Fix for Middleware
async function getSupabaseClient(request: Request) {
  const cookieStore = noCookies;
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
    // The team is entered in body.season (slug or id) of body.division (slug), default the current season.
    const scope = await resolveScope(supabase, { division: body.division, season: body.season });

    const { data, error } = await supabase
      .from('teams')
      .insert([{
        name: body.name,
        short_name: body.short_name,
        logo_url: body.logo_url || null
      }])
      .select()
      .single();

    if (error) throw error;
    const { error: entryError } = await supabase.from('team_entries').insert({ team_id: data.id, season_id: scope.season.id });
    if (entryError) throw entryError;
    return Response.json({ success: true, message: "Team created successfully", data });
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
    return Response.json({ success: true, message: "Team deleted successfully" });
  } catch (error) {
    return handleError(error, "Admin Delete Team");
  }
}
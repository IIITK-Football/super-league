// World Cup flair (finished, read-only archive; D-02): a signed-in user sets the World Cup team flair on their OWN
// profile. The narrow SL-025 fix: the caller is identified from their session token and the update runs as them, so row
// level security allows only their own row. A body user_id other than the caller's is refused (403); the secret key is
// no longer used. The request and response shapes are unchanged.
import { createClient } from '@supabase/supabase-js';
import { publishableKey, supabaseUrl } from '@/lib/supabase/keys';

export async function PATCH(request: Request) {
  try {
    const authorization = request.headers.get('Authorization') ?? '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createClient(supabaseUrl(), publishableKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const { user_id, wc_team_flair } = body as { user_id?: string; wc_team_flair?: string };
    if (!user_id || !wc_team_flair) {
      return Response.json({ error: 'Missing user_id or wc_team_flair' }, { status: 400 });
    }
    if (user_id !== user.id) {
      return Response.json({ error: 'You can only change your own World Cup flair.' }, { status: 403 });
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .update({ wc_team_flair })
      .eq('id', user.id)
      .select('id, nickname, wc_team_flair');
    if (error) throw error;

    return Response.json({ success: true, profile: data?.[0] ?? null });
  } catch (error) {
    console.error('Flair Update Error:', error);
    return Response.json({ error: 'Failed to update World Cup flair' }, { status: 500 });
  }
}

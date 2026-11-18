import { NextResponse } from 'next/server';
import { publishableKey, secretKey } from '@/lib/supabase/keys';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { ScopeError, resolveScope } from '@/lib/scope';

const supabase = createClient(process.env.SUPABASE_URL!, secretKey());

async function getDictator(request: Request) {
  const cookieStore = await cookies();
  const authHeader = request.headers.get('Authorization') || '';
  const authClient = createServerClient(process.env.SUPABASE_URL!, publishableKey(), {
    cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} },
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return null;
  const { data: role } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
  return role?.role === 'admin' || role?.role === 'dictator' ? user : null;
}

export async function POST(request: Request) {
  try {
    if (!await getDictator(request)) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    const body = await request.json();
    if (!body.team_name?.trim() || !body.captain_id) {
      return NextResponse.json({ success: false, message: 'Team and captain are required.' }, { status: 400 });
    }
    // Players and roster places are managed through /api/admin/players and /api/admin/roster; this route only
    // registers the team for a season and assigns its captain. A request that still sends members is refused
    // rather than silently dropping them.
    if (Array.isArray(body.members) && body.members.length) {
      return NextResponse.json({ success: false, message: 'Add players through the season roster, not the registration.' }, { status: 400 });
    }

    // Captain access needs the assignment AND the captain role, but assigning a captain must never silently
    // replace another role ("no role implies another"). Decide before writing anything:
    //   no role / default -> becomes captain;  captain -> unchanged;  dictator -> stays dictator (manages every team);
    //   editor / legacy admin -> refused, because changing those is a deliberate decision.
    const { data: existing } = await supabase.from('user_roles').select('role').eq('user_id', body.captain_id).maybeSingle();
    const currentRole: string | null = existing?.role ?? null;
    if (currentRole && !['default', 'captain', 'dictator'].includes(currentRole)) {
      return NextResponse.json(
        { success: false, message: `This account holds the "${currentRole}" role, which is not changed automatically. Change it deliberately before assigning it as a team captain.` },
        { status: 409 },
      );
    }

    // The team is registered for body.season (slug or id) of body.division (slug), default the current season.
    let scope;
    try {
      scope = await resolveScope(supabase, { division: body.division, season: body.season });
    } catch (scopeError) {
      if (scopeError instanceof ScopeError) return NextResponse.json({ success: false, message: scopeError.message }, { status: scopeError.status });
      throw scopeError;
    }

    let leagueTeamId = body.team_id;
    if (!leagueTeamId) {
      const { data: leagueTeam, error: leagueTeamError } = await supabase.from('teams').insert({
        name: body.team_name.trim(),
        short_name: body.team_name.trim().replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase(),
      }).select('id').single();
      if (leagueTeamError) throw leagueTeamError;
      leagueTeamId = leagueTeam.id;
    }
    const { error: entryError } = await supabase.from('team_entries')
      .upsert({ team_id: leagueTeamId, season_id: scope.season.id }, { onConflict: 'team_id,season_id', ignoreDuplicates: true });
    if (entryError) throw entryError;

    const { data: registration, error: registrationError } = await supabase.from('team_registrations').upsert({
      ...(body.id ? { id: body.id } : {}),
      team_id: leagueTeamId,
      team_name: body.team_name.trim(),
      season_id: scope.season.id,
      captain_id: body.captain_id,
    }, { onConflict: 'captain_id' }).select('id').single();
    if (registrationError) throw registrationError;

    if (currentRole !== 'captain' && currentRole !== 'dictator') {
      const { error: roleError } = await supabase.from('user_roles').upsert({ user_id: body.captain_id, role: 'captain' }, { onConflict: 'user_id' });
      if (roleError) throw roleError;
    }

    return NextResponse.json({ success: true, data: registration });
  } catch (error: any) {
    console.error('Admin team registration error:', error);
    return NextResponse.json({ success: false, message: error.message || 'Could not save team registration.' }, { status: 500 });
  }
}

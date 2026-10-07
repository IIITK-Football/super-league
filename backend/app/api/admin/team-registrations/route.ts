import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function getDictator(request: Request) {
  const cookieStore = await cookies();
  const authHeader = request.headers.get('Authorization') || '';
  const authClient = createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
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

    let leagueTeamId = body.team_id;
    if (!leagueTeamId) {
      const { data: leagueTeam, error: leagueTeamError } = await supabase.from('teams').insert({
        name: body.team_name.trim(),
        short_name: body.team_name.trim().replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase(),
        division: body.division,
      }).select('id').single();
      if (leagueTeamError) throw leagueTeamError;
      leagueTeamId = leagueTeam.id;
    }

    const { data: registration, error: registrationError } = await supabase.from('team_registrations').upsert({
      ...(body.id ? { id: body.id } : {}),
      team_id: leagueTeamId,
      team_name: body.team_name.trim(),
      division: body.division,
      captain_id: body.captain_id,
    }, { onConflict: 'captain_id' }).select('id').single();
    if (registrationError) throw registrationError;

    const { error: roleError } = await supabase.from('user_roles').upsert({ user_id: body.captain_id, role: 'captain' }, { onConflict: 'user_id' });
    if (roleError) throw roleError;

    const members = (body.members || []).map((member: any) => ({
      ...(member.id ? { id: member.id } : {}),
      registration_id: registration.id,
      name: member.name.trim(),
      first_name: member.name.trim().split(/\s+/)[0],
      last_name: member.name.trim().split(/\s+/).slice(1).join(' '),
      email: member.email?.trim() || null,
      position: member.position || null,
      jersey_number: Number(member.jersey_number) || null,
      overall_rating: Number(member.overall_rating) || 50,
      attributes: member.attributes || {},
    }));
    if (members.length) {
      const { error: membersError } = await supabase.from('team_members').upsert(members, { onConflict: 'id' });
      if (membersError) throw membersError;
    }
    return NextResponse.json({ success: true, data: registration });
  } catch (error: any) {
    console.error('Admin team registration error:', error);
    return NextResponse.json({ success: false, message: error.message || 'Could not save team registration.' }, { status: 500 });
  }
}

import { publicClient } from '@/lib/supabase/clients';
import { resolveScope } from '@/lib/scope';
import { handleError } from '../../../lib/errorHandler';

export const dynamic = 'force-dynamic';

type Membership = {
  id: string;
  jersey_number: number | null;
  position: string | null;
  player: { id: string; first_name: string; last_name: string; image_url: string | null; overall_rating: number | null } | null;
  entry: { team: { id: string; name: string } | null } | null;
};

// The season roster (?division=<slug>&season=<slug or id>; default the division's current season), optionally one
// team (?team_id=). Each player appears once, with that season's jersey, position, goals and assists.
export async function GET(request: Request) {
  // Public data only: player cards, season rosters and season statistics are readable by anyone (RLS), and a hidden
  // or archived season cannot be resolved with the public key.
  const supabase = publicClient();
  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get('team_id');
    const scope = await resolveScope(supabase, { division: searchParams.get('division'), season: searchParams.get('season') });

    let query = supabase
      .from('roster_memberships')
      .select(`
        id, jersey_number, position,
        player:players ( id, first_name, last_name, image_url, overall_rating ),
        entry:team_entries!inner ( team_id, team:teams ( id, name ) )
      `)
      .eq('season_id', scope.season.id);
    if (teamId) query = query.eq('entry.team_id', teamId);

    const [{ data: roster, error }, { data: lines, error: statsError }] = await Promise.all([
      query,
      supabase.from('season_player_stats').select('player_id, goals, assists').eq('season_id', scope.season.id),
    ]);
    if (error) throw error;
    if (statsError) throw statsError;

    const stats = new Map((lines ?? []).map((l) => [l.player_id, l]));
    const players = ((roster ?? []) as unknown as Membership[])
      .filter((m) => m.player)
      .map((m) => ({
        id: m.player!.id,
        membership_id: m.id,
        name: `${m.player!.first_name} ${m.player!.last_name}`.trim(),
        first_name: m.player!.first_name,
        last_name: m.player!.last_name,
        position: m.position,
        jersey_number: m.jersey_number,
        image_url: m.player!.image_url,
        overall_rating: m.player!.overall_rating,
        goals: stats.get(m.player!.id)?.goals ?? 0,
        assists: stats.get(m.player!.id)?.assists ?? 0,
        team_id: m.entry?.team?.id ?? null,
        team: m.entry?.team?.name ?? null,
      }))
      .sort((a, b) => (a.position || '').localeCompare(b.position || '') || (a.last_name || '').localeCompare(b.last_name || ''));

    return Response.json({ success: true, data: players });
  } catch (error) {
    return handleError(error, 'Fetch Players');
  }
}

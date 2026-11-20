import { publishableKey } from '@/lib/supabase/keys';
import { createClient } from '@supabase/supabase-js';
import { handleError } from '../../../../lib/errorHandler';

export const dynamic = 'force-dynamic';

// Public data only (RLS): the player's card, roster places and season statistics. Private details are never read here.
const supabase = createClient(process.env.SUPABASE_URL!, publishableKey());

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SeasonRef = { id: string; slug: string; name: string; starts_on: string | null; division: { slug: string; name: string } | null };

// One player: the reusable FUT card (name, portrait, rating, attributes), one line per season (team, jersey,
// position, goals, assists) and a career line that adds the seasons up. Goals and assists always belong to a
// season. The top-level position, jersey, team, goals and assists are those of one season: ?season_id=<uuid> when
// given, otherwise the player's most recent season.
export async function GET(request: Request, { params }: { params: Promise<{ player_id: string }> }) {
  try {
    const { player_id } = await params;
    if (!UUID.test(player_id)) return Response.json({ success: false, error: 'Player not found' }, { status: 404 });
    const requestedSeason = new URL(request.url).searchParams.get('season_id');

    const { data: card, error } = await supabase
      .from('players')
      .select('id, first_name, last_name, image_url, overall_rating, attributes')
      .eq('id', player_id)
      .maybeSingle();
    if (error) throw error;
    if (!card) return Response.json({ success: false, error: 'Player not found' }, { status: 404 });

    const seasonSelect = 'id, slug, name, starts_on, division:divisions ( slug, name )';
    const [{ data: places, error: placesError }, { data: lines, error: linesError }] = await Promise.all([
      supabase
        .from('roster_memberships')
        .select(`season_id, jersey_number, position, season:seasons ( ${seasonSelect} ), entry:team_entries ( team:teams ( id, name ) )`)
        .eq('player_id', player_id),
      supabase.from('season_player_stats').select('season_id, club, goals, assists').eq('player_id', player_id),
    ]);
    if (placesError) throw placesError;
    if (linesError) throw linesError;

    // Seasons the player has a statistic in but no roster place (for example a goal before being rostered).
    const placeSeasons = new Set((places ?? []).map((p) => p.season_id));
    const otherSeasonIds = (lines ?? []).map((l) => l.season_id).filter((id) => !placeSeasons.has(id));
    const { data: otherSeasons, error: otherError } = otherSeasonIds.length
      ? await supabase.from('seasons').select(seasonSelect).in('id', otherSeasonIds)
      : { data: [] as unknown[], error: null };
    if (otherError) throw otherError;

    const stat = new Map((lines ?? []).map((l) => [l.season_id, l]));
    const seasons = [
      ...((places ?? []) as any[]).filter((p) => p.season).map((p) => ({
        season: p.season as SeasonRef,
        team: p.entry?.team ?? null,
        jersey_number: p.jersey_number as number | null,
        position: p.position as string | null,
      })),
      ...((otherSeasons ?? []) as SeasonRef[]).map((s) => ({
        season: s,
        team: stat.get(s.id)?.club ? { id: null, name: stat.get(s.id)!.club } : null,
        jersey_number: null,
        position: null,
      })),
    ]
      .map((s) => ({
        season: { id: s.season.id, slug: s.season.slug, name: s.season.name, starts_on: s.season.starts_on },
        division: s.season.division,
        team: s.team,
        jersey_number: s.jersey_number,
        position: s.position,
        goals: stat.get(s.season.id)?.goals ?? 0,
        assists: stat.get(s.season.id)?.assists ?? 0,
      }))
      .sort((a, b) => (b.season.starts_on ?? '').localeCompare(a.season.starts_on ?? '') || b.season.name.localeCompare(a.season.name));

    const current = (requestedSeason && seasons.find((s) => s.season.id === requestedSeason)) || seasons[0] || null;
    const career = {
      seasons: seasons.length,
      goals: seasons.reduce((n, s) => n + s.goals, 0),
      assists: seasons.reduce((n, s) => n + s.assists, 0),
    };

    return Response.json({
      success: true,
      data: {
        id: card.id,
        name: `${card.first_name} ${card.last_name}`.trim(),
        first_name: card.first_name,
        last_name: card.last_name,
        image_url: card.image_url,
        overall_rating: card.overall_rating ?? null, // not set stays not set
        attributes: card.attributes || null,
        // The season shown on the card.
        season: current ? { ...current.season, division: current.division } : null,
        team: current?.team?.name ?? null,
        team_id: current?.team?.id ?? null,
        position: current?.position ?? null,
        jersey_number: current?.jersey_number ?? null,
        goals: current?.goals ?? 0,
        assists: current?.assists ?? 0,
        seasons,
        career,
      },
    });
  } catch (error) {
    return handleError(error, 'Fetch Player');
  }
}

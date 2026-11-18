import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { handleError } from '../../../lib/errorHandler'; 
import { resolveScope } from '@/lib/scope';

// Turn off caching temporarily so you can test the Mens/Womens toggle instantly!
export const revalidate = 0; 

export async function GET(request: Request) {
  try {
    // ?division=<slug>&season=<slug or id>; without a season, the division's current season.
    const { searchParams } = new URL(request.url);

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          },
        },
      }
    );

    const scope = await resolveScope(supabase, { division: searchParams.get('division'), season: searchParams.get('season') });

    // Seasons played with registration rosters (team_members, e.g. Freshers) record scorers on the match by member
    // id; seasons played with the players roster use the goals table (season_player_stats).
    const { count: registrations, error: registrationsErr } = await supabase
      .from('team_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('season_id', scope.season.id);
    if (registrationsErr) throw registrationsErr;

    if ((registrations ?? 0) > 0) {
      const secret = process.env.SUPABASE_SECRET_KEY;
      if (!secret) {
        throw new Error('SUPABASE_SECRET_KEY is required to fetch Freshers player stats.');
      }

      type PlayerStats = {
        id: string;
        name: string;
        club: string;
        goalsScored: number;
        assists: number;
      };

      const adminSupabase = createClient(process.env.SUPABASE_URL!, secret);
      const [{ data: members, error: membersErr }, { data: matches, error: matchesErr }] = await Promise.all([
        adminSupabase
          .from('team_members')
          .select('id, name, first_name, last_name, team_registrations!inner(team_name, season_id)')
          .eq('team_registrations.season_id', scope.season.id),
        adminSupabase
          .from('matches')
          .select('scorers, assists')
          .eq('season_id', scope.season.id),
      ]);

      if (membersErr) throw membersErr;
      if (matchesErr) throw matchesErr;

      const statsByPlayer = new Map<string, PlayerStats>();
      for (const member of members || []) {
        const registration = Array.isArray(member.team_registrations)
          ? member.team_registrations[0]
          : member.team_registrations;
        const name = member.name || [member.first_name, member.last_name].filter(Boolean).join(' ');

        statsByPlayer.set(member.id, {
          id: member.id,
          name,
          club: registration?.team_name || 'Unassigned',
          goalsScored: 0,
          assists: 0,
        });
      }

      for (const match of matches || []) {
        for (const playerId of match.scorers || []) {
          const player = statsByPlayer.get(playerId);
          if (player) player.goalsScored += 1;
        }
        for (const playerId of match.assists || []) {
          const player = statsByPlayer.get(playerId);
          if (player) player.assists += 1;
        }
      }
      const playerStats = [...statsByPlayer.values()];
      const sortByStat = (stat: 'goalsScored' | 'assists') => playerStats
        .sort((a, b) => b[stat] - a[stat] || a.name.localeCompare(b.name))
        .slice(0, 10);

      return NextResponse.json({
        success: true,
        message: 'Leaderboard fetched successfully',
        data: {
          topScorers: sortByStat('goalsScored'),
          topAssists: sortByStat('assists'),
        },
      });
    }

    // Top 10 scorers and assisters of this season
    const shape = (r: any) => ({ id: r.player_id, name: r.name, club: r.club, goalsScored: r.goals, assists: r.assists });
    const { data: scorerRows, error: scorersErr } = await supabase
      .from('season_player_stats')
      .select('player_id, name, club, goals, assists')
      .eq('season_id', scope.season.id)
      .order('goals', { ascending: false })
      .order('name', { ascending: true })
      .limit(10); 

    if (scorersErr) throw scorersErr;

    const { data: assistRows, error: assistsErr } = await supabase
      .from('season_player_stats')
      .select('player_id, name, club, goals, assists')
      .eq('season_id', scope.season.id)
      .order('assists', { ascending: false })
      .order('name', { ascending: true })
      .limit(10); 

    if (assistsErr) throw assistsErr;
    const topScorers = (scorerRows ?? []).map(shape);
    const topAssists = (assistRows ?? []).map(shape);

    // Send both lists neatly packaged together!
    return NextResponse.json({
      success: true,
      message: "Leaderboard fetched successfully",
      data: {
        topScorers: topScorers || [],
        topAssists: topAssists || []
      }
    });

  } catch (error) {
    return handleError(error, "Leaderboard API Fetch");
  }
}
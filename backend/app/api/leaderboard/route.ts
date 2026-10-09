import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { handleError } from '../../../lib/errorHandler'; 

// Turn off caching temporarily so you can test the Mens/Womens toggle instantly!
export const revalidate = 0; 

export async function GET(request: Request) {
  try {
    // Grab the division from the URL (e.g., ?division=mens)
    const { searchParams } = new URL(request.url);
    const division = searchParams.get('division') || 'mens';

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          },
        },
      }
    );

    if (division === 'freshers') {
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!serviceRoleKey) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to fetch Freshers player stats.');
      }

      type PlayerStats = {
        id: string;
        name: string;
        club: string;
        goalsScored: number;
        assists: number;
      };

      const adminSupabase = createClient(process.env.SUPABASE_URL!, serviceRoleKey);
      const [{ data: members, error: membersErr }, { data: matches, error: matchesErr }] = await Promise.all([
        adminSupabase
          .from('team_members')
          .select('id, name, first_name, last_name, team_registrations!inner(team_name, division)')
          .eq('team_registrations.division', 'freshers'),
        adminSupabase
          .from('matches')
          .select('scorers, assists')
          .eq('division', 'freshers'),
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

    // 1. Fetch Top 10 Scorers for the specific division
    const { data: topScorers, error: scorersErr } = await supabase
      .from('top_scorers')
      .select('*')
      .eq('division', division)
      .order('goalsScored', { ascending: false })
      .limit(10); 

    if (scorersErr) throw scorersErr;

    // 2. Fetch Top 10 Assists for the specific division
    const { data: topAssists, error: assistsErr } = await supabase
      .from('top_scorers')
      .select('*')
      .eq('division', division)
      .order('assists', { ascending: false })
      .limit(10); 

    if (assistsErr) throw assistsErr;

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
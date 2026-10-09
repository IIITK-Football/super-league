import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const revalidate = 0; 

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const division = searchParams.get('division') || 'mens';

    // 1. Fetch all teams in this division
    const { data: teams, error: teamsError } = await supabase
      .from('teams')
      .select('id, name, short_name, logo_url')
      .eq('division', division);

    if (teamsError) throw teamsError;

    // 2. Fetch ALL matches (Ordered by Date!) 
    // This fixes the Form Bug AND gives us the Bracket schedule!
    const { data: allMatches, error: matchesError } = await supabase
      .from('matches')
      .select('id, home_team_id, away_team_id, home_score, away_score, home_penalties, away_penalties, status, date, home:teams!home_team_id(name), away:teams!away_team_id(name)')
      .eq('division', division)
      .order('date', { ascending: true }); // MUST BE ASCENDING FOR CORRECT FORM

    if (matchesError) throw matchesError;

    // 3. Initialize the scoreboard map
    const scoreboard: Record<string, any> = {};
    teams?.forEach(team => {
      scoreboard[team.id] = {
        teamId: team.id,
        teamName: team.name,
        logoUrl: team.logo_url,
        shortName: team.short_name,
        stats: { matchesPlayed: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0 },
        form: [] 
      };
    });

    // 4. Calculate the stats (ONLY using completed matches)
    const completedMatches = allMatches?.filter(m => m.status === 'completed'|| m.status=='forfeited') || [];
    
    completedMatches.forEach(match => {
      const home = scoreboard[match.home_team_id];
      const away = scoreboard[match.away_team_id];

      if (!home || !away) return;

      const homeScore = match.home_score || 0;
      const awayScore = match.away_score || 0;

      home.stats.matchesPlayed++;
      home.stats.goalsFor += homeScore;
      home.stats.goalsAgainst += awayScore;

      away.stats.matchesPlayed++;
      away.stats.goalsFor += awayScore;
      away.stats.goalsAgainst += homeScore;

      // Calculate Points & Win/Loss/Draw chronologically
      if (homeScore > awayScore) {
        home.stats.won++; home.stats.points += 3; home.form.push('W');
        away.stats.lost++; away.form.push('L');
      } else if (awayScore > homeScore) {
        away.stats.won++; away.stats.points += 3; away.form.push('W');
        home.stats.lost++; home.form.push('L');
      } else {
        home.stats.drawn++; home.stats.points += 1; home.form.push('D');
        away.stats.drawn++; away.stats.points += 1; away.form.push('D');
      }

      home.stats.goalDifference = home.stats.goalsFor - home.stats.goalsAgainst;
      away.stats.goalDifference = away.stats.goalsFor - away.stats.goalsAgainst;
    });

    // 5. Convert to Array and Sort by Points
    const standingsArray = Object.values(scoreboard).sort((a, b) => {
      if (b.stats.points !== a.stats.points) return b.stats.points - a.stats.points;
      if (b.stats.goalDifference !== a.stats.goalDifference) return b.stats.goalDifference - a.stats.goalDifference;
      return b.stats.goalsFor - a.stats.goalsFor;
    });

    standingsArray.forEach((team, index) => { team.rank = index + 1; });

    return NextResponse.json({
      success: true,
      message: "Data retrieved successfully",
      data: {
        standings: standingsArray,
        bracketMatches: allMatches // <-- WE SEND THE FULL SCHEDULE FOR THE WOMEN'S BRACKET!
      }
    });

  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ success: false, message: "Failed to fetch standings" }, { status: 500 });
  }
}
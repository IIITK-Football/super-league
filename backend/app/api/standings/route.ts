import { publicClient } from '@/lib/supabase/clients';
import { scopeFromUrl } from '@/lib/scope';
import { handleError } from '@/lib/errorHandler';

export const revalidate = 0; 

export async function GET(request: Request) {
  const supabase = publicClient();
  try {
    // ?division=<slug>&season=<slug or id>; without a season, the division's current season.
    const scope = await scopeFromUrl(supabase, request, { section: 'standings' });

    // The season's teams and all its matches, read together (D-04: at most three sequential rounds).
    const [entriesRes, matchesRes] = await Promise.all([
      supabase.from('team_entries').select('team:teams(id, name, short_name, logo_url)').eq('season_id', scope.season.id),
      // All matches, ordered by date: the form needs the order, and the bracket uses the schedule.
      supabase
        .from('matches')
        .select('id, home_team_id, away_team_id, home_score, away_score, home_penalties, away_penalties, status, date, home:teams!home_team_id(name), away:teams!away_team_id(name)')
        .eq('season_id', scope.season.id)
        .order('date', { ascending: true }), // MUST BE ASCENDING FOR CORRECT FORM
    ]);
    if (entriesRes.error) throw entriesRes.error;
    const teams = (entriesRes.data ?? [])
      .map((e: any) => (Array.isArray(e.team) ? e.team[0] : e.team))
      .filter(Boolean) as { id: string; name: string; short_name: string | null; logo_url: string | null }[];
    const { data: allMatches, error: matchesError } = matchesRes;

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

    return Response.json({
      success: true,
      message: "Data retrieved successfully",
      data: {
        scope: { division: scope.division, season: scope.season },
        standings: standingsArray,
        bracketMatches: allMatches // <-- WE SEND THE FULL SCHEDULE FOR THE WOMEN'S BRACKET!
      }
    });

  } catch (error) {
    return handleError(error, 'Standings');
  }
}
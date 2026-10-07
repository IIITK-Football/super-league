import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const revalidate = 0;

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_ANON_KEY as string;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const requestedDivision = searchParams.get('division') || 'mens';
        const division = ['mens', 'womens', 'freshers'].includes(requestedDivision) ? requestedDivision : 'mens';

        // 1. Fetch Latest News
        const { data: news } = await supabase
            .from('newsletter')
            .select('*')
            .order('date', { ascending: false })
            .limit(5);

        // 2. Fetch Top Scorer & Assist
        const { data: scorers } = await supabase
            .from('top_scorers')
            .select('*')
            .eq('division', division)
            .order('goalsScored', { ascending: false })
            .limit(1);

        const { data: assists } = await supabase
            .from('top_scorers')
            .select('*')
            .eq('division', division)
            .order('assists', { ascending: false })
            .limit(1);

        // --- 3. FETCH ALL TEAMS AND ALL MATCHES TO CALCULATE REAL FORM & STANDINGS ---
        const { data: teams } = await supabase
            .from('teams')
            .select('id, name, logo_url')
            .eq('division', division);

        const { data: allMatches } = await supabase
            .from('matches')
            .select('id, home_team_id, away_team_id, home_score, away_score, status, date, minute, home:teams!home_team_id(name), away:teams!away_team_id(name), goals ( player_id, team_id, minute, is_own_goal, player:players!goals_player_id_fkey ( first_name, last_name ) )')
            .eq('division', division)
            .order('date', { ascending: true }); // MUST BE ASCENDING FOR CORRECT FORM

        // Initialize the scoreboard map
        const scoreboard: Record<string, any> = {};
        teams?.forEach(team => {
            scoreboard[team.id] = {
                teamId: team.id,
                teamName: team.name,
                logoUrl: team.logo_url,
                stats: { points: 0, goalDifference: 0, goalsFor: 0 },
                form: [] // We will store 'W', 'D', 'L' here
            };
        });

        // FIX: Intelligently pick the Hero Match!
        // Priority 1: Find ANY Live Match. Priority 2: Fallback to the next Scheduled Match.
        const liveMatch = allMatches?.find((m: any) => m.status === 'live');
        const nextScheduled = allMatches?.find((m: any) => m.status === 'scheduled');
        let targetMatch: any = liveMatch || nextScheduled || null;

        let liveMatchData: any = null;

    // 4. PROCESS MATCHES (Calculate Form, Standings)
    allMatches?.forEach((match: any) => {
      // Calculate Stats & Form for COMPLETED matches
      if (match.status === 'completed'||match.status==='forfeited') {
        const home = scoreboard[match.home_team_id];
        const away = scoreboard[match.away_team_id];

                if (!home || !away) return;

                const homeScore = match.home_score || 0;
                const awayScore = match.away_score || 0;

                home.stats.goalsFor += homeScore;
                away.stats.goalsFor += awayScore;

                if (homeScore > awayScore) {
                    home.stats.points += 3; home.form.push('W');
                    away.form.push('L');
                } else if (awayScore > homeScore) {
                    away.stats.points += 3; away.form.push('W');
                    home.form.push('L');
                } else {
                    home.stats.points += 1; home.form.push('D');
                    away.stats.points += 1; away.form.push('D');
                }

                home.stats.goalDifference += (homeScore - awayScore);
                away.stats.goalDifference += (awayScore - homeScore);
            }
        });

        // Sort Standings (Top 4)
        const standingsArray = Object.values(scoreboard).sort((a, b) => {
            if (b.stats.points !== a.stats.points) return b.stats.points - a.stats.points;
            if (b.stats.goalDifference !== a.stats.goalDifference) return b.stats.goalDifference - a.stats.goalDifference;
            return b.stats.goalsFor - a.stats.goalsFor;
        });

        standingsArray.forEach((team, index) => { team.rank = index + 1; });
        const top4 = standingsArray.slice(0, 4);

        // 5. BUILD LIVE MATCH DATA
        if (targetMatch) {
            const extractTeamName = (teamData: any) => {
                if (!teamData) return 'TBD';
                if (Array.isArray(teamData)) return teamData[0]?.name || 'TBD';
                return teamData.name || 'TBD';
            };

            const homeGoals = targetMatch.goals?.filter((g: any) => g.team_id === targetMatch.home_team_id).map((g: any) => ({
                name: g.player?.first_name || g.player?.last_name || 'Unknown',
                minute: g.minute,
                isOwnGoal: g.is_own_goal
            })) || [];

            const awayGoals = targetMatch.goals?.filter((g: any) => g.team_id === targetMatch.away_team_id).map((g: any) => ({
                name: g.player?.first_name || g.player?.last_name || 'Unknown',
                minute: g.minute,
                isOwnGoal: g.is_own_goal
            })) || [];

            // Grab the exact form history we just calculated!
            const homeStanding = scoreboard[targetMatch.home_team_id];
            const awayStanding = scoreboard[targetMatch.away_team_id];

            liveMatchData = {
                homeTeam: extractTeamName(targetMatch.home),
                awayTeam: extractTeamName(targetMatch.away),
                homeScore: targetMatch.home_score || 0,
                awayScore: targetMatch.away_score || 0,
                status: targetMatch.status,
                date: targetMatch.date,
                minute: targetMatch.minute || "1'",
                homeForm: homeStanding?.form || [],
                awayForm: awayStanding?.form || [],
                homeScorers: homeGoals,
                awayScorers: awayGoals
            };
        }
        const { data: fantasyUsers } = await supabase
            .from('user_profiles')
            .select('id, nickname, points, mens_team_flair, womens_team_flair')
            .order('points', { ascending: false })
            .limit(5);

        // Map the database response to match what the frontend expects.
        // If there is no data, it safely defaults to an empty array [] !
        const fantasyTop = fantasyUsers?.map((user: any) => ({
            id: user.id,
            name: user.nickname || 'Unknown User',
            points: user.points || 0,
            womens_team_flair: user.womens_team_flair || null,
            mens_team_flair: user.mens_team_flair || null
        })) || [];

        return NextResponse.json({
            success: true,
            data: {
                standings: top4,
                news: news || [],
                topScorer: scorers?.[0] ? (() => { console.log('RAW SCORER ROW:', JSON.stringify(scorers[0])); return { playerId: scorers[0].playerId || scorers[0].id || scorers[0].player_id, name: scorers[0].name || scorers[0].playerName, club: scorers[0].club || scorers[0].teamName, stat: scorers[0].goalsScored }; })() : null,
                topAssist: assists?.[0] ? { playerId: assists[0].playerId || assists[0].id || assists[0].player_id, name: assists[0].name || assists[0].playerName, club: assists[0].club || assists[0].teamName, stat: assists[0].assists || 0 } : null,
                liveMatch: liveMatchData,
                fantasyTop: fantasyTop // Now fully dynamic! Will be empty if no users exist.
            }
        });

    } catch (error) {
        console.error("Dashboard Aggregation Error:", error);
        return NextResponse.json({ success: false, message: "Failed to aggregate dashboard data" }, { status: 500 });
    }
}

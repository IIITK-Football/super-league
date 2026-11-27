import { publicClient } from '@/lib/supabase/clients';
import { scopeFromUrl } from '@/lib/scope';
import { handleError } from '@/lib/errorHandler';
import { FINAL_STATUSES, MATCH_STATUS } from '@/lib/matchStatus';

export async function GET(request: Request) {
    const supabase = publicClient();
    try {
        // ?division=<slug>&season=<slug or id>; without a season, the division's current season.
        const scope = await scopeFromUrl(supabase, request, { section: 'overview' });
        const seasonId = scope.season.id;

        // D-04: at most three sequential Data API rounds. Round 1 resolved the scope; round 2 reads everything that
        // depends only on the season; round 3 reads the fantasy leaders' names and flairs.
        const [newsRes, scorersRes, assistsRes, entriesRes, matchesRes, rankedRes] = await Promise.all([
            // Latest news
            supabase.from('newsletter').select('*').order('date', { ascending: false }).limit(5),
            // Top scorer and top assist of this season
            supabase.from('season_player_stats').select('player_id, name, club, goals')
                .eq('season_id', seasonId).gt('goals', 0)
                .order('goals', { ascending: false }).order('name', { ascending: true }).limit(1),
            supabase.from('season_player_stats').select('player_id, name, club, assists')
                .eq('season_id', seasonId).gt('assists', 0)
                .order('assists', { ascending: false }).order('name', { ascending: true }).limit(1),
            // The season's teams, for form and standings
            supabase.from('team_entries').select('team:teams(id, name, logo_url)').eq('season_id', seasonId),
            supabase.from('matches')
                .select('id, home_team_id, away_team_id, home_score, away_score, status, date, minute, home:teams!home_team_id(name), away:teams!away_team_id(name), match_events ( kind, player_id, team_id, minute, voided_at, player:players!match_events_player_id_fkey ( first_name, last_name ) )')
                .eq('season_id', seasonId)
                .order('date', { ascending: true }), // MUST BE ASCENDING FOR CORRECT FORM
            // Fantasy leaders: points from graded predictions on this season's matches
            supabase.rpc('season_fantasy_leaderboard', { p_season: seasonId, p_limit: 5 }),
        ]);
        for (const res of [newsRes, scorersRes, assistsRes, entriesRes, matchesRes, rankedRes]) {
            if (res.error) throw res.error;
        }
        const news = newsRes.data;
        const scorers = scorersRes.data;
        const assists = assistsRes.data;
        const teams = (entriesRes.data ?? [])
            .map((e: any) => (Array.isArray(e.team) ? e.team[0] : e.team))
            .filter(Boolean) as { id: string; name: string; logo_url: string | null }[];
        const allMatches = matchesRes.data;
        const ranked = rankedRes.data;

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
        const liveMatch = allMatches?.find((m: any) => m.status === MATCH_STATUS.live);
        const nextScheduled = allMatches?.find((m: any) => m.status === MATCH_STATUS.scheduled);
        let targetMatch: any = liveMatch || nextScheduled || null;

        let liveMatchData: any = null;

    // 4. PROCESS MATCHES (Calculate Form, Standings)
    allMatches?.forEach((match: any) => {
      // Calculate Stats & Form for COMPLETED matches
      if (FINAL_STATUSES.includes(match.status)) {
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

            // Goals and own goals of the match (voided events are corrections, never shown); an unattributed goal has no name.
            const goalEvents = (targetMatch.match_events ?? []).filter((e: any) => !e.voided_at && (e.kind === 'goal' || e.kind === 'own_goal'));
            const toGoal = (e: any) => ({
                name: e.player?.first_name || e.player?.last_name || 'Unknown scorer',
                minute: e.minute,
                isOwnGoal: e.kind === 'own_goal'
            });
            const homeGoals = goalEvents.filter((e: any) => e.team_id === targetMatch.home_team_id).map(toGoal);
            const awayGoals = goalEvents.filter((e: any) => e.team_id === targetMatch.away_team_id).map(toGoal);

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
        // Fantasy leaders' nicknames and each user's flair for this division (both depend on the leaderboard)
        const rankedIds = (ranked ?? []).map((r: any) => r.user_id);
        const [namesRes, flairsRes] = await Promise.all([
            rankedIds.length
                ? supabase.from('user_profiles').select('id, nickname').in('id', rankedIds)
                : Promise.resolve({ data: [], error: null }),
            rankedIds.length
                ? supabase.from('division_flairs').select('user_id, team_name').eq('division_id', scope.division.id).in('user_id', rankedIds)
                : Promise.resolve({ data: [], error: null }),
        ]);
        if (namesRes.error) throw namesRes.error;
        if (flairsRes.error) throw flairsRes.error;
        const nicknameById = new Map((namesRes.data ?? []).map((n: any) => [n.id, n.nickname]));
        const fantasyUsers = (ranked ?? []).map((r: any) => ({ id: r.user_id, nickname: nicknameById.get(r.user_id), points: r.points }));
        const flairByUser = new Map((flairsRes.data ?? []).map((f: any) => [f.user_id, f.team_name]));

        const fantasyTop = fantasyUsers?.map((user: any) => ({
            id: user.id,
            name: user.nickname || 'Unknown User',
            points: user.points || 0,
            flair: flairByUser.get(user.id) || null
        })) || [];

        return Response.json({
            success: true,
            data: {
                standings: top4,
                news: news || [],
                scope: { division: scope.division, season: scope.season },
                topScorer: scorers?.[0] ? { playerId: scorers[0].player_id, name: scorers[0].name, club: scorers[0].club, stat: scorers[0].goals } : null,
                topAssist: assists?.[0] ? { playerId: assists[0].player_id, name: assists[0].name, club: assists[0].club, stat: assists[0].assists } : null,
                liveMatch: liveMatchData,
                fantasyTop: fantasyTop // Now fully dynamic! Will be empty if no users exist.
            }
        });

    } catch (error) {
        return handleError(error, 'Dashboard Aggregation');
    }
}

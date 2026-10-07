import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLeague } from '../context/LeagueContext';
import { useApi } from '../hooks/useApi';
import { GlassPanel } from '../components/GlassPanel';
import { FormGuide } from '../components/FormGuide';
import { Loader } from '../components/Loader';
import { STANDINGS_CONFIG } from '../data/standingsConfig';

function MatchCard({ title, team1, team2, note1, note2 }) {
    return (
        <div className="bg-white/[0.03] border border-white/10 p-4 rounded-2xl relative overflow-hidden group hover:bg-white/10 transition-all backdrop-blur-md">
            <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-white/40 to-transparent"></div>
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400 mb-3">{title}</h3>
            <div className="space-y-2">
                <div className="flex justify-between items-center bg-black/40 rounded-lg p-2 px-3 border border-white/5">
                    <span className="font-bold text-white text-sm truncate mr-2">{team1}</span>
                    <span className="text-xs font-black text-white uppercase tracking-widest whitespace-nowrap">{note1}</span>
                </div>
                <div className="flex justify-between items-center bg-black/40 rounded-lg p-2 px-3 border border-white/5">
                    <span className="font-bold text-white text-sm truncate mr-2">{team2}</span>
                    <span className="text-xs font-black text-white uppercase tracking-widest whitespace-nowrap">{note2}</span>
                </div>
            </div>
        </div>
    );
}

// 1. UPDATED BRACKET: Now it reads real data from the database!
function WomensBracket({ matches = [], title, buttonText }) {

    // Helper function to safely map chronologically scheduled games to the bracket slots
    const getMatchData = (index, fallbackHome, fallbackAway, fallbackNote1, fallbackNote2) => {
        const m = matches[index];
        if (!m) return { team1: fallbackHome, team2: fallbackAway, note1: fallbackNote1, note2: fallbackNote2 };

        // If the game is live or finished, show the real score!
        const showScore = m.status === 'live' || m.status === 'completed';

        // Extract team names safely (fixing the TypeScript array issue from earlier!)
        const homeName = Array.isArray(m.home) ? m.home[0]?.name : m.home?.name;
        const awayName = Array.isArray(m.away) ? m.away[0]?.name : m.away?.name;

        return {
            team1: homeName || fallbackHome,
            team2: awayName || fallbackAway,
            note1: showScore ? m.home_score : fallbackNote1,
            note2: showScore ? m.away_score : fallbackNote2
        };
    };

    const q1 = getMatchData(0, "Kulasthree FC", "FAAAH United", "", "");
    const q2 = getMatchData(1, "DILF", "Red Wolves", "", "");
    const e1 = getMatchData(2, "Loser of Q1", "Loser of Q2", "", "");
    const s1 = getMatchData(3, "Fivestars", "Winner of Q1", "", "");
    const s2 = getMatchData(4, "Winner of Q2", "Winner of E1", "", "");
    const final = getMatchData(5, "Winner of Semi 1", "Winner of Semi 2", "Champ", "Runner Up");
    const losers = getMatchData(6, "Loser of Semi 1", "Loser of Semi 2", "3rd", "");

    return (
        <div className="space-y-12 animate-in fade-in duration-700 pb-12">
            <div className="text-center space-y-4">
                <h2 className="text-4xl sm:text-5xl font-black tracking-tighter uppercase text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-500">
                    {title}
                </h2>
                <p className="text-zinc-400 font-medium tracking-widest uppercase">
                    {buttonText}
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 relative">
                <div className="space-y-6">
                    <h3 className="text-center font-black text-zinc-500 uppercase tracking-widest text-sm border-b border-white/10 pb-4">1. Qualifiers</h3>
                    <MatchCard title="Qualifier 1" {...q1} />
                    <MatchCard title="Qualifier 2" {...q2} />
                </div>
                <div className="space-y-6">
                    <h3 className="text-center font-black text-zinc-500 uppercase tracking-widest text-sm border-b border-white/10 pb-4">2. Eliminator</h3>
                    <div className="hidden lg:block h-[112px]"></div>
                    <MatchCard title="Eliminator 1" {...e1} />
                </div>
                <div className="space-y-6">
                    <h3 className="text-center font-black text-zinc-500 uppercase tracking-widest text-sm border-b border-white/10 pb-4">3. Semifinals</h3>
                    <MatchCard title="Semifinal 1" {...s1} />
                    <MatchCard title="Semifinal 2" {...s2} />
                </div>
                <div className="space-y-6">
                    <h3 className="text-center font-black text-zinc-500 uppercase tracking-widest text-sm border-b border-white/10 pb-4">4. Finals</h3>
                    <MatchCard title="Loser's Final" {...final} />
                    <MatchCard title="Final" {...losers} />
                </div>
            </div>
        </div>
    );
}

export function Standings() {
    const { division: divisionParam } = useParams();
    const navigate = useNavigate();
    const { setDivision } = useLeague();
    const division = STANDINGS_CONFIG[divisionParam] ? divisionParam : 'mens';
    const config = STANDINGS_CONFIG[division];

    useEffect(() => {
        setDivision(division);
    }, [division, setDivision]);

    const { data: apiResponse, loading, error } = useApi(config.dataEndpoint);

    // 2. We extract the bracketMatches from the backend and pass it to the component!
    const bracketMatches = apiResponse?.data?.bracketMatches || [];

    if (config.view === 'bracket') {
        return <WomensBracket matches={bracketMatches} title={config.title} buttonText={config.buttonText} />;
    }

    if (loading) {
        return <Loader text="Loading Live Standings..." />;
    }

    if (error) {
        return (
            <div className="flex justify-center items-center h-64">
                <span className="text-red-500/80 font-black tracking-widest uppercase text-sm">
                    Database Connection Failed
                </span>
            </div>
        );
    }

    const standings = apiResponse?.data?.standings || [];

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-12">
            <div className="flex items-end justify-between px-2">
                <div>
                    <h2 className="text-3xl sm:text-4xl font-black tracking-tighter uppercase">{config.title}</h2>
                    <p className="text-zinc-400 mt-1 font-medium">League leader wins the championship. Top 2 clubs qualify for next edition.</p>
                </div>
                <button
                    type="button"
                    onClick={() => navigate(`/standings/${division}`)}
                    className="hidden sm:block border border-white/15 px-4 py-2 text-xs font-black uppercase tracking-widest text-zinc-300 hover:border-white/40 hover:text-white transition-colors"
                >
                    {config.buttonText}
                </button>
            </div>

            <GlassPanel className="overflow-x-auto relative">
                <div className="min-w-[900px] w-full">
                    <div className="grid grid-cols-[3rem_2.5fr_3rem_3rem_3rem_3rem_3rem_3rem_3rem_4rem_10rem] gap-2 p-4 border-b border-white/10 text-[11px] sm:text-xs font-bold tracking-wider text-zinc-500 bg-black/60 uppercase">
                        <div className="text-center">Rank</div>
                        <div>Club</div>
                        <div className="text-center">MP</div>
                        <div className="text-center">W</div>
                        <div className="text-center">D</div>
                        <div className="text-center">L</div>
                        <div className="text-center">GF</div>
                        <div className="text-center">GA</div>
                        <div className="text-center text-zinc-300">GD</div>
                        <div className="text-center text-white">Pts</div>
                        <div className="pl-4">Form</div>
                    </div>

                    <div className="flex flex-col">
                        {standings.map((team, idx) => {
                            const promotes = idx < 4;
                            return (
                                <div
                                    key={team.teamId}
                                    className={`
                    grid grid-cols-[3rem_2.5fr_3rem_3rem_3rem_3rem_3rem_3rem_3rem_4rem_10rem] gap-2 p-4 items-center 
                    ${idx !== standings.length - 1 ? 'border-b border-white/5' : ''} 
                    hover:bg-white/5 transition-colors
                    ${promotes ? 'bg-white/[0.02]' : ''}
                  `}
                                >
                                    <div className="font-mono text-[16px] sm:text-xl font-bold text-center text-zinc-400">{team.rank}</div>

                                    <div className="font-bold text-[15px] sm:text-lg flex items-center gap-2 sm:gap-3 min-w-0 pr-4">
                                        {team.logoUrl && <img src={team.logoUrl} className="w-5 h-5 sm:w-6 sm:h-6 object-contain shrink-0" alt={team.teamName} />}
                                        <span className="truncate" title={team.teamName}>{team.teamName}</span>
                                    </div>

                                    <div className="text-center text-zinc-400">{team.stats?.matchesPlayed || 0}</div>
                                    <div className="text-center text-zinc-400">{team.stats?.won || 0}</div>
                                    <div className="text-center text-zinc-400">{team.stats?.drawn || 0}</div>
                                    <div className="text-center text-zinc-400">{team.stats?.lost || 0}</div>
                                    <div className="text-center text-zinc-400">{team.stats?.goalsFor || 0}</div>
                                    <div className="text-center text-zinc-400">{team.stats?.goalsAgainst || 0}</div>

                                    <div className="text-center font-mono text-zinc-300">
                                        {team.stats?.goalDifference > 0 ? `+${team.stats?.goalDifference}` : (team.stats?.goalDifference || 0)}
                                    </div>

                                    <div className="text-center font-black text-2xl">{team.stats?.points || 0}</div>

                                    <div className="pl-4 hidden sm:block">
                                        {/* Slice (-5) works perfectly now because the oldest matches are first in the array! */}
                                        <FormGuide form={(team.form || []).slice(-5)} />
                                    </div>
                                    <div className="pl-4 block sm:hidden text-xs tracking-widest text-zinc-400">
                                        {(team.form || []).slice(-5).join('')}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </GlassPanel>
        </div>
    );
}

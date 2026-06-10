import React, { useEffect, useState } from 'react';
import { useLeague } from '../context/LeagueContext';
import { Calendar, Loader2, Shield } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Loader } from '../components/Loader';

// GLOBAL MATCH CARD COMPONENT
function MatchCard({ match, onClick }) {
    const homeName = match.home?.name || 'TBA';
    const awayName = match.away?.name || 'TBA';

    return (
        <div
            onClick={onClick}
            className="bg-[#1A1820] border border-white/5 hover:border-white/20 rounded-2xl p-4 sm:p-6 cursor-pointer hover:bg-white/5 transition-all group relative overflow-hidden"
        >
            <div className="flex justify-between items-center text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 sm:mb-6">
                <span className="flex items-center gap-1.5 sm:gap-2">
                    <Calendar className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    {match.date ? new Date(match.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'TBA'}
                </span>
                <span className={match.status === 'live' ? 'text-red-500 animate-pulse' : 'text-zinc-400'}>
                    {match.status === 'live' ? `LIVE • ${match.minute || "1'"}` : match.status}
                </span>
            </div>

            <div className="flex items-center justify-between gap-2 sm:gap-4 w-full">
                {/* Home Team */}
                <div className="flex-1 text-right flex flex-col justify-center">
                    <h3 className="text-[13px] sm:text-xl md:text-2xl font-black uppercase tracking-tight leading-tight text-white">
                        {homeName}
                    </h3>
                </div>

                {/* Score / VS */}
                <div className="bg-black/60 px-3 py-2 sm:px-6 sm:py-3 rounded-xl border border-white/10 font-black text-xl sm:text-3xl tabular-nums text-transparent bg-clip-text bg-gradient-to-b from-white to-zinc-500 shadow-xl shrink-0">
                    {match.status === 'scheduled' ? 'VS' : `${match.home_score || 0} - ${match.away_score || 0}`}
                </div>

                {/* Away Team */}
                <div className="flex-1 text-left flex flex-col justify-center">
                    <h3 className="text-[13px] sm:text-xl md:text-2xl font-black uppercase tracking-tight leading-tight text-white">
                        {awayName}
                    </h3>
                </div>
            </div>
        </div>
    );
}

export function Matches() {
    const { division, setView } = useLeague();
    const [matches, setMatches] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchMatches = async () => {
            setLoading(true);
            try {
                const { data, error } = await supabase
                    .from('matches')
                    .select('id, status, date, home_score, away_score, minute, home_team_id, away_team_id, division, home:teams!home_team_id(name), away:teams!away_team_id(name)')
                    .eq('division', division)
                    .order('date', { ascending: false }); // Sort newest to oldest

                if (error) throw error;
                setMatches(data || []);
            } catch (err) {
                console.error("Error fetching matches:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchMatches();
    }, [division]); // Refetch if the user toggles between Mens/Womens

    const handleSelectMatch = (match) => {
        sessionStorage.setItem('selectedMatch', JSON.stringify(match));
        sessionStorage.setItem('matchSource', 'matches'); // <-- ADD THIS
        setView('matchTimeline');
    };
    if (loading) {
        return <Loader text="Loading Matches..." />;
    }

    // Group Matches by Status
    const liveMatches = matches.filter(m => m.status === 'live');
    const scheduledMatches = matches.filter(m => m.status === 'scheduled').reverse(); // Reverse so soonest scheduled is first
    const completedMatches = matches.filter(m => m.status === 'completed' || m.status === 'forfeited');

    return (
        <div data-testid="page-matches" className="space-y-12 animate-in fade-in duration-500 pb-12">
            <h1 className="text-3xl sm:text-5xl font-black tracking-tighter uppercase">
                <span>Matches</span>
            </h1>

            {matches.length === 0 ? (
                <div className="flex flex-col items-center justify-center min-h-[30vh] text-zinc-500 space-y-4 bg-white/5 border border-white/10 rounded-3xl">
                    <Shield className="w-12 h-12 text-zinc-700" />
                    <span className="font-black tracking-[0.3em] uppercase text-sm">No matches found for this division</span>
                </div>
            ) : (
                <div className="space-y-12">

                    {/* LIVE SECTION */}
                    {liveMatches.length > 0 && (
                        <div className="space-y-4">
                            <h2 className="text-xl font-black text-red-500 tracking-widest uppercase flex items-center gap-2">
                                <span className="relative flex h-3 w-3">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                                </span>
                                Live Now
                            </h2>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {liveMatches.map(m => (
                                    <MatchCard key={m.id} match={m} onClick={() => handleSelectMatch(m)} />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* UPCOMING SECTION */}
                    {scheduledMatches.length > 0 && (
                        <div className="space-y-4">
                            <h2 className="text-xl font-black text-white tracking-widest uppercase border-b border-white/10 pb-2">Upcoming Fixtures</h2>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {scheduledMatches.map(m => (
                                    <MatchCard key={m.id} match={m} onClick={() => handleSelectMatch(m)} />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* COMPLETED SECTION */}
                    {completedMatches.length > 0 && (
                        <div className="space-y-4">
                            <h2 className="text-xl font-black text-zinc-500 tracking-widest uppercase border-b border-white/10 pb-2">Past Results</h2>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {completedMatches.map(m => (
                                    <MatchCard key={m.id} match={m} onClick={() => handleSelectMatch(m)} />
                                ))}
                            </div>
                        </div>
                    )}

                </div>
            )}
        </div>
    );
}
